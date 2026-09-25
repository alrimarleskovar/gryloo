# Enforcement matrix v1 — Mode A fork profile

Status: accepted for BUILD-003D under DEC-0023 and DEC-0024. This is an additive artifact contract in `@defi-workflow-engine/workflow-contracts@0.2.0`. Every pre-existing v1 schema and compatibility fixture remains byte-identical.

## Identity and hash

The closed `enforcement-matrix` schema is `urn:defi-workflow-engine:contracts/v1/enforcement-matrix`, with `schemaVersion: "1.0.0"`. Its canonical hash uses the existing DWE-HASH v1 framing, SHA-256 and RFC 8785 JSON, in the new domain `defi-workflow-engine/enforcement-matrix`. The artifact does not contain its own hash. No signature, runtime status or omitted field is accepted by the closed schema.

`enforcementMatrixId` identifies the document. The six predecessor hashes bind the Semantic Workflow IR, Artifact Set, Simulation Bundle, Authorization Policy, Strategy Manifest and Execution Plan. `authorizationMode` is exactly `MODE_A`. `environment` binds `FORK_REPRODUCED`, execution chain `eip155:31337`, source chain `eip155:8453`, source block height and hash, the state-source transcript hash and the raw simulation response hash.

## Payload and limit rows

Each payload row binds a step ID, the frozen `payloadHash`, profile `EVM_EIP1559_UNSIGNED_V1`, decoded chain, owner, nonce, target, zero value, function selector, gas limit, fee caps and arguments. The arguments are one of:

- `APPROVE`: spender and exact amount;
- `EXACT_INPUT_SINGLE`: token pair, fee tier, owner recipient, input amount, minimum output, zero price limit and Unix deadline wrapped by SwapRouter02 multicall.

The selector must match the argument kind. Payload, step and limit identities are unique; a limit's payload bindings must refer to a row in this matrix. A limit row has an ID, description, value, locations and field bindings. The seven possible locations are `EXACT_SIGNED_PAYLOAD`, `APPLICATION_GATEWAY`, `INTENT_PROTOCOL`, `SMART_ACCOUNT_MODULE_OR_GUARD`, `PROTOCOL_VERIFIER`, `MONITOR_ONLY` and `NOT_ENFORCED`. Including a location in the vocabulary does not claim that BUILD-003D uses it. The compiler uses only the locations listed in the approved plan §3.7; it cannot claim an intent protocol, smart-account guard or independent protocol verifier.

Canonical projection sorts payload rows by step ID, limit rows by limit ID, each row's locations and field bindings, and the limitations list. It preserves all schema fields. The compatibility fixture and its test exercise raw ingress, projection, linkage to the exact synthetic unsigned payload bytes and rejection of malformed, mismatched or extra fields.

## Meaning

The v1 policy, Manifest and plan continue to say `NOT_ENFORCED`: those documents themselves are not enforcement mechanisms. The matrix locates each Mode A limit in exact signed bytes, application checks or monitoring. In particular, cumulative reservation and revocation epoch remain `NOT_ENFORCED`. A residual allowance is monitored; revocation is a new Mode A execution, not an implicit rollback. The matrix is explanatory and hash-bound evidence, never wallet authority on its own.

C-9 through C-12 in the BUILD-003D plan remain contract debt for a later v2 design.

## G2 frozen additive files

SHA-256 of `packages/workflow-contracts/schemas/v1/enforcement-matrix.schema.json`: `eaa5cb51b9d1b44c17eec7f6eb0c12e09d8d599e3d51a1f1a711470feab00930`. SHA-256 of `tests/compatibility/v1/enforcement-matrix.json`: `947177e134bc44b6ed1d8d461ccca80994638a9b614718e6382bd437fd8dbe5d`. SHA-256 of `tests/compatibility/v1/mode-a-payload-vectors.json`: `8d0483d739c4f65949cdc8f904bc1f74f7309d0e5a84467b94c520656e560d18`. The contract test pins all three exact byte sequences.
