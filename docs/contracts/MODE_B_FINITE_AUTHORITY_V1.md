# Mode B finite authority v1 — local fork profile

Status: implemented for BUILD-004 local chain 31337 only. This document describes the new permission profile and does not revise frozen DWE-HASH v1 artifacts.

## Inputs and commitment

`hashModeBPermission` accepts exactly the 27 fields listed in `packages/workflow-contracts/src/canonical.ts`, including the chain ID, Safe, Roles, Safe owner and threshold, **Roles owner equal to Safe**, executor, role key, target, selector, complete call bytes, token pair, recipient, exact input, minimum output, cumulative native-unit budget, one-time allowance key, protocol deadline, code hashes, semantic workflow hash, quote hash, simulation hash, source block hash and revocation method. It rejects extra or missing fields. The JCS-canonical JSON is framed under `defi-workflow-engine/mode-b-permission/v2` with DWE-HASH version byte 2 and SHA-256. The fixed vector is in `tests/compatibility/v1/mode-b-permission-vectors.json`; independent Python recomputation verifies it. Existing v1 domains and vectors remain byte-identical.

The permission hash is a review and journal binding. The onchain installation consists of separate chain-31337 owner transactions whose calldata is compiled from that same permission: optional transfer of Roles ownership to Safe; optional Safe module enablement; Safe-owned Roles target and function scope; Safe-owned one-time non-refilling allowance; Safe-owned executor role assignment; and a finite ERC-20 router allowance from Safe. The server confirms each signed owner transaction by independently decoding raw chain bytes and comparing signer, chain, target and exact calldata with the reviewed step. A hash stored only in the application is not permission enforcement.

## Enforcing boundary

The single executor identity may call only Zodiac Roles `execTransactionWithRole` for the compiled role. Roles scopes the Router02 target, `multicall(uint256,bytes[])` selector, exact deadline, exact nested `exactInputSingle` bytes, zero value and call operation, and a one-time allowance. The exact nested bytes fix input token, output token, fee tier, Safe recipient, native-unit input amount, minimum output and price limit. The Uniswap router enforces the protocol deadline and minimum output. One successful call consumes the allowance; direct replay or same-block competing calls cannot consume it twice. The worker reserves the Execution ID and permission hash in an fsynced journal before sending; this is duplicate-dispatch protection, not the independent spend limit.

The Roles allowance tuple's fourth word is the remaining call count. Gryloo displays native-unit remaining budget as that count multiplied by the exact input amount. It displays the ERC-20 router allowance separately. The executor pays gas locally; an independent gas maximum is **not enforced by Roles**. The exact onchain role remains listed after its router deadline until owner revocation, so the UI must distinguish an expired economic call from confirmed permission removal.

## Recovery and revocation

A browser-independent local worker loads the immutable prepared record and a disposable executor key from a mode-0600 file under `/tmp`; it accepts no arbitrary transaction endpoint. A fresh process resumes a `PENDING` journal entry by reading its receipt. An unknown send becomes `INCONCLUSIVE` and is never blindly retried. It needs chain nonce, receipt, permission consumption and balance investigation before any replacement. No owner key enters Gryloo's server, repository, journal or browser state.

Owner revocation comprises four distinct Safe transactions: remove the exact role, disable the executor module in Roles, disable Roles in Safe, and set the token router allowance to zero. Only successful receipts plus direct module/role/allowance readback may display `REVOCATION_CONFIRMED`. A local pause or stopped worker cannot revoke chain authority. Previously confirmed swap effects remain final.

## Evidence and limits

The evidence ceiling is `FORK_REPRODUCED` on local chain 31337 backed by the frozen BUILD-003F closed Base replay. The replay extension answers only unrecorded reads for disposable local deployments; it must not replace recorded Base contract state. Synthetic chain-8453 mechanism tests are `MOCKED`. No public chain, production key, user funds, provider request or paid service is authorized. Exact signed installation, complete browser journey, unknown-send investigation, residual allowance and revocation are mandatory BUILD-004 acceptance gates; a passing compiler hash alone is not certification.
