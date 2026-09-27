# ADR-0001 — Finite Mode B authority

- Status: `IMPLEMENTED_LOCAL_FORK; ACCEPTANCE_PENDING`
- Owner decision: D-1 approved Safe 1.4.1 plus Zodiac Roles 2.1.0 for BUILD-004, limited to local chain 31337 and `FORK_REPRODUCED` evidence.
- Public-chain or production authority: none.

## Selection and exact local identity

The approved profile uses one disposable Safe owner (threshold 1 of 1) and a distinct disposable executor. Both keys are generated for each local fork and deleted when it stops, so owner and executor addresses are not fixed identities.

The committed harness `apps/reference-dapp/e2e/fork/mode-b-harness.mjs` deploys every contract from one hash-derived local-only deployer `0x7b3b65eef7e90adb842561a9d77c8c4e922fb884`. The resulting contract identities are deterministic and were identical across every clean-fork run:

| Contract | Address | Runtime Keccak-256 |
|---|---|---|
| Safe proxy | `0x329d16e745216b393c1e6ece8d0e3c9ac5b8e241` | `0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c` |
| Roles | `0xd62a9493d0f8b3b8d6498a6c9c24503b5eafe1ec` | `0x047f43dd5021237132c566a4f0646caf616779972504c64194635077b724a9a9` |
| SafeL2 singleton | `0x35414118e46f9febcbab910a800932a24ddc156b` | `0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff` |

Other locally deployed contracts:

- ERC-2470 singleton factory: `0x6119fdd9d755b82d225491e2eea37bf7c2db28d5`;
- Roles `Integrity` library: `0x3b25d127d62b40816f29b8dc368aee4ade76638f`;
- Roles `Packer` library: `0xe086a343d12d0c3627a646c802371e6c600316a2`.

The Safe proxy runtime equals the official SafeProxy runtime. Roles is the official 2.1.0 creation bytecode re-linked, as a linker would, from the official Integrity, Packer and ERC-2470 factory addresses to these local deployments. The link is checked by exact occurrence counts. The Roles runtime hash therefore differs from the official Base deployment and pins this relinked local instance.

Pinned inputs, supplied outside Git and never redistributed:

- Safe is pinned to 1.4.1 tag `bf943f80fec5ac647159d26161446ac5d716a294`. The reviewed `SafeL2.json` artifact has SHA-256 `a57d54c0d757ca7fb86693480797de69c880878690b67061f6f9624e11def8bd`; `SafeProxy.json` has SHA-256 `b05eaeaf7278097e52a9e9b38410de2a812c23fa3622373473e73eaa19646ecd`.
- Roles is pinned to contract package 2.1.0, Solidity `v0.8.21+commit.d9974bed`. Its canonical compiler input SHA-256 is `a012f17facc3151513125f3e20b99262fcad940552f7d672dc6d48a9e8570335`, and the source/deployment JSON has SHA-256 `a80d737a2b5394897fad0aa290b129bc446fdb1736efc3e1ad06edcd2d8ea224`.
- The ERC-2470 init code has SHA-256 `dae33ba7a8745a325d78fd9dbf4585b47524070f5c8b73c84bf373e91a24fff6`, byte-identical to the specification.

The frozen BUILD-003F source block is Base 8453 block 51797365, hash `0x9951e66b23109cf6f9fb7d89cad05a2de38a15ac2ba789330dc8fb91613c0d82`. The certified transcript is served strictly closed. Local-only accounts and the three owner-selected `LOCAL_SETUP_NOT_BASE_OBSERVED` Safe token slots are defined in [BUILD-004 plan §14](../builds/BUILD-004-PLAN.md) under DEC-0032.

## Authority map

Roles is owned by the Safe after setup. The Safe owner wallet signs each installation and revocation transaction. Direct owner authority over the Safe remains broader than the executor role and is displayed separately. The executor key exists only in a mode-0600 disposable local file outside Git and is loaded only by the worker process. The model, browser and general app server do not receive that key. The worker can send only the prepared exact Roles transaction. Chain ID is bound by EIP-1559 signing and the local deployment; target, selector, exact nested parameters, value/call operation and one-time budget are checked by Roles; deadline and minimum output are checked by Uniswap; local journal idempotency and gas submission policy are application gates. The permission hash binds the review to installed calldata but is not an onchain verifier by itself. See `docs/contracts/MODE_B_FINITE_AUTHORITY_V1.md` for field-level semantics.

## Threat and bypass proof

A compromised UI, API or worker cannot expand the disposable executor's target, token, receiver, function, amount or cumulative spend through its role. Direct calls outside the UI/API are signed by the disposable executor key and mined on the controlled fork. Each rejection must be an onchain revert, not an RPC refusal. Wrong target, selector, token, recipient, amount one native unit high, deadline, value and delegatecall reverted; foreign-chain signatures were refused; replay and post-revocation calls reverted. Same-block competing calls produced one success and one revert. A call after the Router02 deadline reverted. Safe-owned Roles setup was independently checked. Executor attempts to transfer Roles ownership, use an owner Safe signature and change the Safe fallback handler failed. The Safe owner can intentionally change Safe/module authority; that owner bypass is outside the executor ceiling and cannot be represented as delegated least authority.

Roles is deployed owned by the Safe, with the Safe as avatar and target. Every Roles administration call is a Safe owner transaction, and the worker refuses to execute unless direct readback shows Safe ownership. An earlier working-tree proof began with an EOA-owned Roles instance and an extension that answered unrecorded reads with zeros. Neither is BUILD-004 evidence.

## Revocation and limits

Wallet-controlled revocation removes the exact role, disables executor membership in Roles, disables Roles in Safe, and zeroes the residual router allowance. The chain receipt and direct readback, not local pause, determine confirmation. The owner retains emergency authority to disable the Safe module and clear allowance. Unknown submission, inconsistent RPC and residual allowance remain explicit states. Worker gas cap, owner coercion, Safe owner key safety, live provider availability, production executor key rotation, formal audit and public-chain deployment are not independently proven by this local build. The local Roles owner and code are pinned; contract source/binaries are not redistributed in Git. BUILD-004 acceptance remains pending the full browser, security, governance, CI and owner wallet gates; this ADR does not claim public or production certification.
