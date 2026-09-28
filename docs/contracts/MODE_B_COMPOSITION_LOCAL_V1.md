# Mode B composition local profile v1

BUILD-007 adds the `mode-b-composition-permission` v3 hash domain and strict v1 profile without changing any frozen v1 schema, domain or compatibility vector. `@defi-workflow-engine/workflow-contracts` becomes 0.3.0; the six approved consumers pin `workspace:0.3.0`. The additive compatibility vector is `tests/compatibility/v2/mode-b-composition-vectors.json`.

The profile binds local chain 31337, Base source block hash, Safe 1.4.1 and Roles 2.1.0 addresses and code, owner/executor, Router02, Position Manager and pool code, semantic workflow and artifact-chain hashes, two role and allowance keys, exact swap input and minimum, mint pair/fee/ticks, two upper bounds, two fixed minimums, Safe NFT recipient, deadlines and cumulative USDC budget. See `packages/workflow-contracts/src/mode-b-composition-permission.ts` for the exact field order and validation.

Hash order is semantic workflow → artifact set → simulation → policy → Manifest → composition permission. Exact payload hashes, execution attempt and evidence bundle follow. The two-node IR contains only the typed WETH output reference; observed quote, range state and runtime token ID are external. A changed material value retires descendants and needs new owner signatures.

The onchain authority is two independent Safe/Zodiac Roles scopes, each with one non-refilling call. The mint scope checks target, selector, tuple identity, range, Safe recipient, desired-token upper bounds, fixed minimums and deadline. Its `LessThan(cap + 1)` comparator makes each cap inclusive. Finite ERC-20 approvals bound spend per spender. The permission and Manifest hashes are review commitments, not onchain guards. Gas and ordering are local application gates. The Safe owner retains broader authority.

`FORK_REPRODUCED` requires one new complete transcript and `REPLAY_BYTE_IDENTICAL`, plus direct bypass and independent reconciliation. `MOCKED` rehearsals do not raise that ceiling. The fork's chain ID is 31337; no payload is valid on Base chain 8453.
