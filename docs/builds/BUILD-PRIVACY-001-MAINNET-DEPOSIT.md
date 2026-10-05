# BUILD-PRIVACY-001 — minimum owner-controlled Cloak deposit

## Current boundary — 2026-10-05

The standalone **0.01 SOL deposit** is implemented and genuine SDK/public-mainnet preparation passed. **READY_FOR_OWNER_EXECUTION is false**: dependency admission remains blocked. No owner signature, financial submission, mainnet proof or challenge acceptance is claimed. Completing the private swap is not a prerequisite. The existing LOCAL demo and ordinary production financial gate are unchanged.

Public owner: `6NTyfs83wzEo7WkkhTuNSxXiyYM9x73icbdtQWVbhaRy`. SDK: `@cloak.dev/sdk@0.2.5`. Mainnet program: `zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW`. Recipient: the SDK-derived native SOL shield pool. No swap, USDC ATA or Jupiter route is involved. [Cloak documents the 0.01 SOL minimum and free shielding](https://www.cloak.ag/); network fees and rent are additional wallet debits.

## Genuine read-only preflight

The actual SDK generated its ceremony proof, fetched the signed risk quote and existing lookup table, and constructed one **1,231-byte unsigned version-0 transaction**. A capture-only signer aborts SDK execution before wallet interaction; its RPC is read-only and root retries are zero. No fabricated or legacy deposit builder is used.

Fresh actual-mainnet unsigned simulation returned **PASSED**:

| Item | Lamports | SOL |
| --- | ---: | ---: |
| Shielded principal | 10,000,000 | 0.01 |
| Cloak deposit protocol fee | 0 | 0 |
| Network fee | 10,000 | 0.00001 |
| Account rent | 1,960,880 | 0.00196088 |
| Total simulated wallet debit | 11,970,880 | 0.01197088 |

Current public rent reads and an independently inspected existing native deposit corroborate rent for two one-byte nullifier accounts and one zero-byte risk nonce account. Observed owner balance: 0.212485584 SOL, sufficient for this estimate; no funding request is needed. Third-party historical transactions are configuration evidence, never this owner's proof. The public-only diagnostic is in ignored `.turbo/privacy-owner-deposit-readonly.json`.

Network fee and total debit bind the Manifest and are checked again before signing and before broadcast. Preparation expires in 60 seconds and retains the block-height lifetime. Generate a new preparation and review before any approved signing; diagnostic hashes and transactions cannot be reused.

## Authorization, encrypted custody and recovery

Both actual SDK outputUtxos are generated and encrypted **before proving**: the funded recoverable note and zero-value padding output. The same outputs are supplied to SDK transact and bound to proof commitments. Viewing material and salts stay in the encrypted browser vault. No implicit off-chain viewing registration or wallet-message signature is performed. A local encrypted recovery backup is mandatory before signing.

The distinct deposit Manifest binds owner, Cloak, native mint, mainnet genesis/program/pool, positive exact 10,000,000-lamport deposit, output commitment, nonce, exact transaction digest, network fee, total debit, freshness and block-height lifetime. Branded authorization rejects changed/copied preparations. No ordinary workflow acquires financial capability through this isolated route.

Wallet Standard requests one explicit owner-controlled transaction signature only after fresh preflight, Review, Manifest authorization, encrypted backup and admission. Returned bytes/message and owner Ed25519 signature are verified. Atomic note/nonce/global-owner-proof reservations and encrypted intent precede signing; signed bytes and handoff are encrypted before submission.

The browser's same-origin **read-only** Server Action uses the actual fixed mainnet RPC/SDK codecs because public RPC rejects browser-origin requests. It cannot broadcast or simulate signed transactions. A separate broadcast action independently checks admission, signed message, Review, pool, genesis, lifetime, fee and unsigned preflight. It writes/fsyncs an exclusive per-owner **public** journal before its sole RPC send with maxRetries zero. Neither server action receives note secrets or vault passphrases.

Timeout/response loss permits chain inspection only. Browser/server restart or authenticated backup restoration cannot sign/resend blindly. Restore reserves the owner-proof attempt and quarantines it from authorization. Missing/corrupt custody state fails closed. A deposit has no automatic rollback, refund, withdrawal or retry; a failed/absent transaction remains recovery-required and paid fees remain public.

Completion requires exact successful finalized signed wire; canonical tree matched to a finalized program-owned root; both proof-bound outputs with unique leaf indices; SDK recovery of the funded note from retained material; and funded-note unspent state. Both indexed outputUtxos are encrypted, reloaded and compared before success. Relay status or an RPC response alone cannot establish completion.

Public evidence includes signature/explorer link, slot/block time, owner/program/genesis, principal, output commitment, Manifest/review hashes, one-submission count and reconciliation/reload verdict. The separate encrypted backup contains all private outputs and checkpoints. Public evidence excludes spending/viewing keys, salts, nullifier secrets and vault material. The deposit wallet, amount, program/pool, fees, time and commitments are public; note spending secrets and shielded custody remain private.

## Exact launch and owner steps

Read-only preparation (financial gate disabled):

```bash
cd /home/asus/projects/gryloo/.turbo/privacy001/apps/reference-dapp
FLOFI_CLOAK_OWNER_PROOF=0 node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3019
```

Open `http://127.0.0.1:3019/privacy/mainnet-proof`. Unlock a durable vault with a locally entered passphrase, click **Prepare 0.01 SOL deposit — no signature**, inspect/export Review and Manifest, and export the encrypted backup. The signing button remains disabled. Never share the passphrase or private backup contents.

Future admitted launcher, only after dependency review and explicit owner confirmation:

```bash
cd /home/asus/projects/gryloo/.turbo/privacy001
FLOFI_CLOAK_PROOF_OWNER=6NTyfs83wzEo7WkkhTuNSxXiyYM9x73icbdtQWVbhaRy node scripts/privacy-owner-proof.mjs
```

Requires pinned pnpm 11.22.0 and a clean reviewed Privacy checkout. The unchanged dependency verifier, low-severity audit threshold and SBOM must pass before writing an expiring owner/HEAD/lockfile-bound admission. An environment switch cannot bypass admission. **The launcher currently fails dependency admission; do not bypass it.**

After admission and confirmation: prepare fresh, review exact fee/message/Manifest, save encrypted backup, choose this owner wallet, acknowledge Review and explicitly opt into ONE proof. **Sign and submit ONE reviewed 0.01 SOL Cloak deposit** opens the wallet for one transaction approval, followed by at most one application broadcast. Save updated encrypted backup, click **Inspect finalized mainnet and reconcile saved note**, and export public evidence plus final encrypted backup. No separate setup, token approval, swap or wallet-message signature is required by the currently measured path.

## Validation and admission

- 103 focused tests passed in nine files, including all original 40 LOCAL lifecycle cases and 35 new deposit/bridge tests: default/explicit gates, unchanged production disablement, admission flags, changed Review/Manifest/message, replay, uncertainty, encrypted outputs, quarantined restore and corruption. Three independent server tests verify journal fsync before send, zero retries, duplicate rejection and retention after response loss.
- Genuine Node SDK/public-mainnet proof preparation and unsigned simulation passed: one unsigned transaction, zero signatures, zero submissions.
- Production build/TypeScript and scoped ESLint passed. Isolated mainnet-preparation browser suite: two passed, including genuine SDK proof/unsigned mainnet simulation, encrypted backup and reload without any wallet. Unchanged LOCAL browser suite: three passed, one optional ceremony case skipped. Frozen schemas: 11 verified. Governance and 17 self-tests passed. Separate live-swap regression: 63 tests passed with verified offline ceremony artifacts; no live swap acceptance is implied.
- Fresh audit: one low Elliptic advisory. Unchanged inventory/license verifier: 21 findings, including unapproved SDK/prover pins, 411 identities versus 262 admitted and 14 license findings. CycloneDX SBOM generated with 411 components; generation is not admission. No lockfile, dependency policy, verifier or CI migration change.

Fresh official npm metadata still reports Elliptic latest 6.6.1, no published 6.6.2 and Cloak stable 0.2.5. The audit-suggested Elliptic upgrade is unavailable; no staging SDK, handwritten cryptographic patch or advisory waiver was substituted.

Development used fresh unsubmitted SDK notes and synthetic test wallets; no owner private note was read. Full private-swap funded settlement/refund evidence remains a separate later stage.
