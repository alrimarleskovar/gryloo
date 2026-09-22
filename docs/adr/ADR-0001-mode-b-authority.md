# ADR-0001 — Mode B authority mechanism

- Status: `PROPOSED`
- Decision: unresolved
- Approval required: separate explicit human approval

## Context

Mode B must bind execution to a maximum policy at an enforcement boundary that
remains effective if the UI, application API, or executor is compromised. An
application-side check, Manifest hash, monitoring alert, or model instruction is
not sufficient enforcement.

## Alternatives under consideration

- A version-pinned smart-account module or guard enforcing call, asset, amount,
  recipient, time, nonce, and budget constraints.
- A version-pinned smart-contract vault or policy account with equivalent limits.
- A version-pinned intent verifier or settlement mechanism whose validation is
  independent of the proposing and executing service.
- A narrowly scoped session/delegation mechanism backed by independently
  enforced onchain constraints.

No alternative is selected or approved.

## Selection and enforcement criteria

The mechanism must be established and auditable; identify chain, version,
deployment, owners, threshold, executor identity, and key boundary; fail closed;
enforce target, selector, asset, amount, recipient, slippage, price, time, nonce,
replay, cumulative budget, expiry, and revocation limits where applicable; expose
deterministic evidence; support pause and recovery semantics; and prevent an
executor from expanding its own authority.

## Threat model

Required analysis includes compromised UI/API, malicious model output,
compromised executor or key, replay, nonce races, stale observations, policy
substitution, signature-domain confusion, upgrade or owner bypass, malicious
targets, reentrancy, partial cross-chain completion, censorship, and unavailable
revocation paths.

## Bypass tests required before acceptance

Tests must operate outside the normal UI and API path and attempt unauthorized
targets/selectors, excessive amounts and cumulative budgets, stale or altered
policies, replayed nonces, expired authority, invalid domains/chains, direct
executor calls, owner/upgrade bypasses, and execution after revocation. Each must
fail at the claimed independent boundary.

## Evidence and unresolved decisions

Acceptance requires pinned source and deployment evidence, threat-model review,
successful bypass testing, key and upgrade documentation, revocation proof, and
reproducible policy-to-enforcement mapping. Chain, account model, mechanism,
deployment, owners, threshold, executor, keys, limits, upgrade posture, and
revocation path remain unresolved. This ADR does not certify or implement Mode B.
