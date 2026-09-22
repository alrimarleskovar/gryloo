# Gryloo — Master Product Specification

**Status:** Final v3.2 for team implementation, bounded-authority validation and embedded distribution  
**Version:** 3.2  
**Date:** 21 September 2026  
**Category:** Verifiable multichain DeFi workflow composition and execution  
**Execution modes:** Mode A transaction authorization, Mode B finite delegated execution, and bounded Mode C automation after Mode B certification  
**Brand status:** `Gryloo` is the team-approved product name following market research; protocol-level identifiers remain technically neutral

---

## 1. Executive decision

Build a **conversational and visual compiler plus bounded executor for multichain DeFi strategies**.

Users can describe a strategy through chat, construct it on a visual canvas, or move bidirectionally between both interfaces. The system converts the strategy into a typed workflow, retrieves routes and sources, simulates the complete sequence, reviews risks and dependencies, generates a verifiable Strategy Manifest and executes only what the user authorized.

> Describe or draw a DeFi strategy. The engine turns it into a verifiable workflow, finds the routes, simulates the risks and executes only within your authorization.

The product is not a concentrated-liquidity manager. Concentrated liquidity is one template inside a broader action system that can compose:

- swaps;
- bridges;
- lending and borrowing;
- collateral management;
- liquidity positions;
- staking and vaults;
- conditions, alerts and monitoring;
- later, arbitrage and other advanced strategies.

The product has two distribution modes built on the same engine:

- **Original DApp:** the complete interface for creating, reviewing, signing, tracking and recovering workflows;
- **embedded engine:** a widget, SDK, API or MCP integration that lets wallets, fintechs, on/off-ramps and crypto platforms offer the same capabilities inside their own products.

This embedded layer does not create a second thesis. It distributes the Gryloo v3.2 engine through partner channels. Every execution still produces the same Semantic Workflow IR, Strategy Manifest, Execution ID, canonical states and evidence. The original Gryloo DApp remains the canonical center for tracking and recovery, including when the journey began outside it.

The product's trust promise depends on the authorization mode:

> **Mode A:** The payload you review is the payload you authorize.
>
> **Modes B and C:** The policy you sign defines the maximum authority the executor may exercise.

The v3.2 implementation must prove six things:

1. Chat and canvas produce the same canonical Semantic Workflow IR.
2. Mode A binds review to an exact transaction, batch or signed intent without overstating Manifest enforcement.
3. At least one finite Mode B workflow continues after the browser closes while an independent enforcement boundary rejects an unauthorized receiver, token, chain, function, amount, replay and expired authority.
4. A multichain workflow can pause, continue, retry, refund when supported, or require intervention safely after an asynchronous failure.
5. Semantic plan, observed data, simulation, authorization, execution attempts and evidence remain separately hashed and traceable.
6. An execution started through a partner can be tracked and recovered in the original DApp without losing context, authorization or evidence.

---

## 2. Product thesis

### 2.1 Problem

DeFi exposes powerful financial primitives but forces users to coordinate fragmented interfaces, networks, assets and permissions. A multi-step strategy may require users to:

- inspect balances on several chains;
- compare swaps and bridge routes;
- calculate token proportions;
- deposit collateral and borrow;
- manage approvals and network gas;
- enter a liquidity position;
- monitor price ranges, debt and health factor;
- recover manually if a step fails halfway.

Simple users do not know which steps are required. Intermediate users understand the desired outcome but not every protocol detail. Advanced users understand the strategy but still waste time translating it into transactions and monitoring logic.

### 2.2 Product hypothesis

If users can express or visually construct a DeFi strategy, inspect an exact executable representation, validate its assumptions and authorize bounded execution, then DeFi can become simpler without turning control over to an unrestricted agent.

### 2.3 Product category

**Verifiable multichain DeFi workflow composition and execution.**

### 2.4 Positioning

The engine sits above routing, protocol and wallet infrastructure. It does not replace LI.FI, Enso, Aave, Uniswap, Jupiter, Almanak or wallets. It compiles protocol capabilities into a user-owned semantic plan, explicit authority, recoverable execution and evidence. Its differentiation is not generic natural-language strategy generation or smart-account automation; it is the no-code bidirectional experience, multichain composition, bounded authority, recovery and verifiable evidence across direct and embedded surfaces.

### 2.5 Hackathon pitch

> Other tools generate transactions or strategy code. We let users describe or draw a strategy, inspect the same typed plan in chat and canvas, authorize exact payloads or bounded policy, and verify every effect across chains.

---

## 3. Product principles

1. **User-directed:** the user chooses the objective and approves material parameters.
2. **Bidirectional:** chat and canvas are two views of the same workflow.
3. **Typed before executable:** language-model output never becomes raw calldata directly.
4. **Verifiable authorization:** the signed plan is bound to amounts, protocols, chains and limits.
5. **Minimum signatures, not false one-click claims:** reduce prompts where infrastructure permits, disclose when more are required.
6. **Fail closed:** stale data, unsupported actions or changed state stop execution.
7. **Recoverable by design:** cross-chain flows expose state, retries, refunds and manual intervention.
8. **Evidence first:** every action links back to intent, simulation, authorization and receipt.
9. **One execution, multiple surfaces:** partner and DApp display the same canonical state, never competing histories.
10. **Distribution does not expand authority:** partner branding, templates or recommendations never replace the Manifest or the user's signature.
11. **Artifacts do not collapse:** the semantic plan, observed state, simulation, authorization, execution journal and evidence remain distinct.
12. **Authority is explicit:** every execution declares Mode A, B or C and exactly where each limit is enforced.
13. **Parallel development, serial certification:** teams may build in parallel, but no primitive or composition is certified before its dependencies pass their gates.

---

## 4. Target users and modes

### 4.1 Beginner mode

The user states a simple outcome:

> Swap 1,000 USDC for ETH on Base using the best net execution after fees.

The product discovers routes, explains the result, simulates and requests authorization.

### 4.2 Guided mode

The user states a multi-step outcome:

> Use my USDC to enter an ETH/USDC liquidity pool on Arbitrum. Bridge if necessary, calculate the token composition required by a range 10% above and below the current price, and explain any residual assets.

The product supplies missing steps and asks the user to approve network, pool, range, cost and failure policies.

### 4.3 Advanced mode

The user builds through chat or canvas:

> Supply ETH to Aave, borrow USDC only if the projected health factor at execution remains above 1.8, bridge to the selected chain, swap the required amount and add liquidity. After execution, monitor and alert if the position leaves range or health factor approaches 2.0.

The product acts as compiler, reviewer, simulator and executor rather than inventing the investment thesis.

### 4.4 Secondary customers

- wallets embedding strategy composition;
- DAO and protocol treasuries;
- agent developers needing a bounded execution gateway;
- strategy creators publishing reusable workflows;
- DeFi protocols seeking safer multistep onboarding;
- fintechs, exchanges, on/off-ramps and crypto content platforms seeking to embed DeFi execution;
- educators, research desks and communities seeking to publish executable templates without taking custody of funds.

### 4.5 Non-target users for the initial releases

- users who cannot understand wallet authorization;
- users expecting guaranteed returns;
- high-frequency arbitrageurs requiring colocated low-latency execution;
- institutions requiring custody and complete regulatory reporting from day one.

---

## 5. Core product experience

### 5.1 Entry surfaces

The user can start in either surface:

- **Chat:** describe the desired outcome or add steps conversationally.
- **Canvas:** drag typed financial nodes and connect dependencies.

Both surfaces must remain synchronized. Editing an amount in chat updates the canvas. Reconnecting nodes on the canvas changes the natural-language summary.

The same engine may also appear in an **embedded partner surface**. That surface may present a curated template, limited chat or a simplified canvas, but it has no parallel executable representation. It always loads or creates the same canonical Semantic Workflow IR.

### 5.2 Main lifecycle

1. Connect wallets and read balances with explicit permission.
2. Describe or draw the strategy.
3. Compile it into a Semantic Workflow IR revision.
4. Resolve missing data and dependencies into versioned Quote and State Artifacts.
5. Run deterministic validation and AI-assisted review without allowing AI output to become authority.
6. Produce a Simulation Bundle for the complete workflow and its failure paths.
7. Compile the Authorization Policy and Strategy Manifest for Mode A, B or C.
8. User reviews the semantic diff, artifacts, simulation, enforcement matrix and authority.
9. Create the Execution Plan and obtain the required wallet authorization.
10. Persist the Execution ID, policy references and initial journal entry before submission.
11. Execute through chain and protocol adapters.
12. Reconcile receipts, intents, balances, allowances, debt, positions, fees and residual assets.
13. Continue, wait, retry, cancel when supported, request refund when supported, compensate under separate authority, or request intervention according to policy.
14. Monitor the resulting position and produce an Evidence Bundle.
15. When initiated through a partner, return status through API/webhook and allow the same execution to be opened in the original DApp.

### 5.3 User controls

- edit every material parameter;
- lock a node against AI modification;
- require approval before selected nodes;
- set spending, gas, slippage and risk limits;
- inspect sources and quote timestamps;
- compare alternative routes;
- choose automatic or manual recovery;
- request local pause, inspect active permissions and submit or confirm revocation through the mechanism that granted authority;
- export the workflow, manifest and execution record;
- verify the partner, author and template version that originated the workflow;
- continue in the original DApp without restarting the operation or re-signing anything that has not changed.

---

## 6. Canonical use cases

### 6.1 Simple same-chain swap

**Intent:** Swap USDC to ETH on the same network.

**Workflow:** balance read -> route discovery -> quote comparison -> simulation -> signature -> swap -> receipt.

**Acceptance:** ranking uses net output after gas and disclosed risk, not nominal output alone.

### 6.2 Cross-chain liquidity entry

**Intent:** Move USDC from one chain, obtain the token composition required for a selected concentrated-liquidity range and enter the position.

**Workflow:** balance -> route -> bridge -> destination confirmation -> split/swap -> pool validation -> add liquidity -> monitor.

**Acceptance:** the workflow survives bridge delay, quote expiry and destination gas insufficiency without silently changing the plan.

### 6.3 Lending-to-liquidity strategy

**Intent:** Supply collateral to Aave, borrow within a health-factor policy, convert borrowed assets and enter a liquidity position.

**Workflow:** collateral supply -> borrow simulation -> health check -> borrow -> swap/bridge if required -> add liquidity -> monitor debt and range.

**Acceptance:** execution stops if the projected health factor, calculated from the complete account state and identified oracle data at the execution checkpoint, falls below the Manifest limit. Monitoring after execution is separate from this checkpoint and does not guarantee prevention of future liquidation.

### 6.4 User-authored advanced workflow

The user adds actions step by step through chat or canvas. The product validates dependencies, token flow, funding, gas, approvals and exit logic.

### 6.5 Arbitrage

The product vision supports arbitrage nodes, but live competitive arbitrage is not a core release promise. Gryloo may detect and simulate an opportunity. Live execution requires private order flow, latency engineering, MEV protection and strict profitability guarantees.

---

## 7. Canonical artifact model

### 7.1 Purpose

The system uses one canonical semantic plan, but it must not collapse mutable observations, simulation results, authorization, execution state and evidence into that plan. Every artifact is typed, versioned, hashable and linked to its predecessors.

### 7.2 Mandatory artifact separation

| Artifact | Purpose | Mutability |
|---|---|---|
| Semantic Workflow IR | User-owned financial intent, operations, dependencies and constraints | Immutable per revision |
| Quote and State Artifacts | External observations, quotes, balances, protocol state and provenance | Append-only snapshots with expiry |
| Simulation Bundle | Deterministic and scenario results derived from one IR revision and one artifact set | Immutable result |
| Authorization Policy | Maximum authority requested from the user | Immutable per policy revision |
| Strategy Manifest | Canonical envelope linking the plan, reviewed artifacts, Simulation Bundle, policy and authorization mode | Immutable once authorized |
| Execution Plan | Adapter-specific actions permitted under the authorized Manifest | Immutable per attempt set; regenerated only within policy |
| Execution Journal | Workflow, segment, step and attempt transitions before and after submission | Append-only |
| Evidence Bundle | Reconciled result, receipts, differences, residual effects and verification status | Append-only with superseding versions |

Updating a quote, status, receipt or monitoring result must never mutate the Semantic Workflow IR or silently change an authorization hash.

### 7.3 Node classes

| Class | Nodes |
|---|---|
| Read | Balance, position, price, pool, allowance, gas |
| Route | Find swap, find bridge, compare execution |
| Action | Swap, bridge, supply, borrow, repay, stake, add/remove liquidity |
| Logic | Condition, branch, split, merge, wait, timeout |
| Risk | Health factor, slippage, exposure, allowlist, spend cap |
| Approval | Exact payload, signed intent, checkpoint, delegated permission |
| Recovery | Retry, abort, cancel when supported, request refund, compensate, pause |
| Monitor | Price, range, health factor, completion, alert |

### 7.4 Semantic Workflow IR

Every semantic node includes only stable or explicitly versioned meaning:

- stable node identifier;
- action type and schema version;
- chain and required capability;
- protocol or adapter constraints without silently selecting mutable routes;
- asset identity by chain, address or canonical native-asset identifier, plus decimals;
- typed inputs, output references and expected semantic outputs;
- dependencies and resource-consumption edges;
- user constraints and failure policy;
- required authorization class;
- locked parameters and editable bounds.

The Semantic Workflow IR excludes live quotes, timestamps, simulation results, execution status, receipts and evidence.

### 7.5 Quote and State Artifacts

Every external observation records:

- source and adapter version;
- chain ID and block or slot reference;
- retrieval timestamp and expiration or freshness rule;
- raw-response hash and normalized typed values;
- quote, route, order or provider identifier;
- contracts, spenders and recipients proposed by the provider;
- fees, gas assumptions, output bounds and known uncertainty;
- validation status against the Action Registry.

External data remains untrusted until validation. Expired artifacts cannot be reused merely because the semantic plan is unchanged.

### 7.6 Simulation Bundle

The Simulation Bundle binds:

- one Semantic Workflow IR revision;
- the exact Quote and State Artifact set;
- adapter and contract versions;
- expected, minimum and adverse outcomes;
- propagated outputs across dependent nodes;
- failure-path results and residual assets;
- uncertainty, unsupported assumptions and freshness limits.

Simulation of isolated nodes does not prove the composed workflow. Separate origin and destination forks are not represented as a globally atomic snapshot.

### 7.7 Execution Journal and Evidence Bundle

The journal records state at workflow, segment, step and attempt level. Every submission is persisted before and after external side effects. The Evidence Bundle reconciles receipts or settlements with balances, allowances, debt, positions, fees, ownership and residual assets.

Evidence environment is exactly one of:

```text
MOCKED
FORK_REPRODUCED
TESTNET_EXECUTED
MAINNET_EXECUTED
```

Evidence status is one of:

```text
CONFIRMED_NOT_RECONCILED
RECONCILED
INCONCLUSIVE
DIVERGENT
```

A confirmed transaction is not automatically a verified business outcome.

### 7.8 Determinism and concurrent editing

The language model may propose and explain graph changes. Only the deterministic compiler may convert validated nodes into adapter calls. No address, recipient, amount or calldata supplied only by model output is trusted.

Chat and canvas submit typed changes against a `baseRevision`. Conflicting edits fail rather than silently overwriting each other. Material edits invalidate dependent quotes, simulations, policies and authorizations.

### 7.9 Canonical identifiers and hashes

At minimum, the system defines and tests:

- `semanticWorkflowHash`;
- `artifactSetHash`;
- `simulationHash`;
- `policyHash`;
- `manifestHash`;
- `payloadHash` or `intentHash` for each executable action;
- `executionAttemptId` before each submission;
- `evidenceBundleHash` after reconciliation.

Canonicalization rules explicitly enumerate included and excluded fields. No mutable runtime field may accidentally invalidate or preserve authority.

---

## 8. Strategy Manifest and authorization policy

### 8.1 Definition

The Authorization Policy defines the maximum authority requested from the user. The Strategy Manifest is the canonical envelope that links the semantic plan, reviewed artifacts, Simulation Bundle, policy, authorization mode and revocation mechanism.

The Manifest must never imply stronger enforcement than the actual wallet, intent protocol, smart account, module, guard, verifier or application boundary provides.

### 8.2 Required contents

- Manifest, policy and Semantic Workflow IR versions and hashes;
- owner, source accounts, destination accounts and permitted recipients;
- authorization mode: A, B or C;
- principal executor identity when delegated authority exists;
- permitted chains, adapters, protocols, contracts and functions;
- verified asset identifiers by chain and address;
- maximum total, cumulative and per-step amounts as integer native units;
- budget-reservation and concurrent-consumption rules;
- minimum outputs as integer native units;
- maximum slippage, gas and protocol or platform fees;
- separate gas assets and gas budgets;
- health-factor, LTV and exposure checks with account scope, oracle source and evaluation checkpoint;
- fixed providers or an explicitly authorized provider set;
- deadlines, quote-expiry rules, nonce and revocation epoch;
- retry, requote, pause, cancel, refund-request, compensation and intervention rules;
- enforcement location for every material limit.

USD values are derived presentation values with source, timestamp and staleness rules. They are never the only executable limit.

### 8.3 Simplified manifest

```json
{
  "manifestVersion": "2.0",
  "semanticWorkflowHash": "0x...",
  "artifactSetHash": "0x...",
  "simulationHash": "0x...",
  "policyHash": "0x...",
  "authorizationMode": "MODE_B_FINITE_DELEGATION",
  "owner": "eip155:8453:0xOwner",
  "principalExecutor": "eip155:8453:0xExecutor",
  "expiresAt": "2026-09-21T22:00:00Z",
  "revocationEpoch": "7",
  "assets": [
    {
      "chainId": 8453,
      "token": "0xUSDC",
      "decimals": 6,
      "maxCumulativeSpend": "5000000000"
    }
  ],
  "allowedCalls": [
    {
      "chainId": 8453,
      "target": "0xVerifiedRouter",
      "functions": ["exactInputSingle"]
    }
  ],
  "limits": {
    "maxSlippageBps": 50,
    "maxGasWei": "2000000000000000",
    "minFinalValue": {
      "chainId": 8453,
      "token": "0xUSDC",
      "amount": "4850000000"
    }
  },
  "recovery": {
    "quoteExpired": "PAUSE_FOR_APPROVAL",
    "unknownSubmissionResult": "RECONCILE_BEFORE_RETRY",
    "destinationFailure": "PAUSE_FOR_APPROVAL"
  },
  "recipients": ["eip155:8453:0xOwner"]
}
```

### 8.4 Enforcement matrix

For every material rule, the UI and Evidence Bundle identify one or more enforcement locations:

```text
EXACT_SIGNED_PAYLOAD
INTENT_PROTOCOL
SMART_ACCOUNT_MODULE_OR_GUARD
PROTOCOL_VERIFIER
APPLICATION_GATEWAY
MONITOR_ONLY
NOT_ENFORCED
```

Application validation is useful but does not prove that a compromised backend lacks authority to bypass it. At least one Mode B path must demonstrate rejection outside the normal UI and application happy path.

### 8.5 Authorization binding by mode

- **Mode A:** the wallet signs the exact transaction, batch or protocol intent. The Manifest links review and evidence, but the product must not claim onchain policy enforcement that the signed payload does not provide.
- **Mode B:** the user signs finite delegated authority enforced by a smart account, module, guard, verifier or intent mechanism. The executor may continue without the browser only inside the policy.
- **Mode C:** the user signs bounded recurring authority with explicit budget, frequency, duration, triggers and revocation. Mode C begins only after Mode B certification.

Writing a `manifestHash` beside a transaction in a database is not signature binding. Where a policy hash is claimed as signed, the signed typed data or enforcing contract must verifiably include it or derive equivalent constraints.

### 8.6 Requote and provider semantics

The policy declares whether a provider is fixed or selected from a pre-authorized set. Price and amount may be refreshed only within explicit bounds. A provider, execution-kind, target-contract, recipient or function change is material unless the signed policy explicitly authorizes that exact variability.

### 8.7 Pause, revocation, cancellation and refund

These states are distinct:

```text
LOCAL_PAUSED
REVOCATION_REQUESTED
REVOCATION_SUBMITTED
REVOCATION_CONFIRMED
ORDER_CANCELLATION_AVAILABLE
ORDER_CANCELLED
REFUND_REQUEST_AVAILABLE
REFUND_REQUESTED
REFUNDED
IRREVERSIBLE_EFFECT_CONFIRMED
```

Stopping a worker does not revoke an allowance, module, session key or open order. Revocation does not reverse confirmed effects. Refund availability depends on the protocol or route. Compensation is a new authorized action with its own cost and evidence.

---

## 9. Strategy Review Engine

The Review button runs two separate systems.

### 9.1 Deterministic linter

Blocks or warns about:

- missing dependencies;
- insufficient balance or destination gas;
- unverified tokens or contracts;
- approvals broader than required;
- quote expiration before dependent steps;
- health factor below policy;
- incompatible token decimals;
- bridge assets that differ from expected destination assets;
- absent repay, unwind or recovery step;
- unsupported atomicity assumptions;
- output below minimum value;
- native-unit budget reuse or double spending across branches;
- stale oracle, quote or state artifacts;
- an adapter, execution kind, target, function or recipient outside policy;
- a runtime field incorrectly included in or excluded from canonical hashing;
- a claimed revocation, refund or health guarantee that the selected mechanism cannot provide.

### 9.2 AI reviewer

Explains the strategy, highlights economic assumptions and suggests optional changes. It may identify concentration, liquidity, impermanent-loss or liquidation risks, but cannot silently modify locked parameters or approve execution.

### 9.3 Review output

| Level | Meaning |
|---|---|
| Block | Workflow cannot execute under current rules |
| Warning | User may continue after explicit acknowledgement |
| Information | Assumption or tradeoff to understand |
| Suggestion | Optional improvement requiring user acceptance |

---

## 10. Chained simulation

### 10.1 Requirement

Simulation covers the workflow, not only isolated transactions. Each node consumes the simulated output of its dependencies.

### 10.2 Required outputs

- balances before and after each step;
- expected and minimum received amounts;
- approvals and allowance changes;
- cumulative gas, bridge and protocol fees;
- debt, complete account collateral and projected health factor at identified checkpoints;
- token composition calculated for the selected liquidity range, ticks and current price;
- bridge timing assumptions;
- residual assets after partial failure;
- final portfolio exposure;
- confidence and data freshness.
- budget reservations, concurrent consumption and gas reserves;
- the enforcement matrix for every material limit.

### 10.3 Scenarios

At minimum:

1. expected execution;
2. maximum allowed slippage;
3. delayed bridge and expired destination quote;
4. adverse price movement;
5. failure at every non-atomic boundary;
6. unknown submission result followed by reconciliation;
7. revocation during pending or cross-chain execution;
8. partial fill, late arrival and policy expiry;
9. backend or UI attempt to change recipient, token, function or provider.

### 10.4 Limitation

Simulation is evidence, not a guarantee. Cross-chain state, MEV, gas and prices can change after authorization.

---

## 11. Execution semantics

### 11.1 Same-chain atomic execution

When wallet and protocol capabilities allow, compatible actions may be batched into an atomic call. If any required call fails, no material effect should remain except gas according to the execution environment.

### 11.2 Same-chain sequential execution

If atomic execution is unavailable, the interface must show each transaction, dependency and possible partial state. The user may authorize a batch, but the system must not label it atomic.

### 11.3 Cross-chain execution

Cross-chain workflows are asynchronous state machines, not globally atomic transactions. A source-chain authorization may create an intent or bridge order, while destination execution happens after settlement.

### 11.4 Minimum-signature principle

The product optimizes for one review and the fewest safe signatures:

- wallet batching where supported;
- Permit or Permit2 for bounded token authorization;
- ERC-4337 or programmable accounts for scoped execution;
- intent/solver authorization for supported cross-chain outcomes;
- explicit additional signature when infrastructure cannot preserve the approved guarantees.

Setup, account creation, permission installation and revocation may require separate signatures. The interface must distinguish setup signatures from strategy authorization and subsequent execution.

### 11.5 Finite delegated execution

Mode B separates the LLM from the executor. The LLM has no signing key and no unrestricted RPC submission path. A deterministic executor may hold or use only a bounded executor identity whose effective authority is constrained by the selected enforcement mechanism.

At least one certified Mode B workflow must:

- continue after the browser closes;
- survive worker restart;
- complete only the authorized finite plan;
- reject unauthorized receiver, token, chain, target, function, amount, replay, expiry and revoked authority outside the UI;
- expose every remaining permission and a concrete revocation procedure.

### 11.6 Prohibited claims

The product must never promise that every multichain strategy executes atomically or with one blockchain transaction.

It must also never describe a flow as delegated or autonomous when a human or hidden operator must approve each future action, or describe application-only checks as cryptographic enforcement.

---

## 12. Recoverable multichain execution

### 12.1 Hierarchical state model

A single linear enum is insufficient. State is tracked at four levels:

- **workflow:** overall user objective and terminal result;
- **segment:** same-chain or cross-chain execution boundary;
- **step:** semantic operation such as bridge, swap or supply;
- **attempt:** one concrete transaction, signed intent, order, deposit or recovery action.

The workflow may follow:

```text
DRAFT -> REVIEWED -> SIMULATED -> AUTHORIZED -> EXECUTING
-> RECONCILING -> COMPLETED
```

Workflow alternatives include:

```text
PAUSED | RECOVERY_REQUIRED | PARTIALLY_COMPLETED | FAILED | EXPIRED | CANCELLED
```

Attempt states include:

```text
PREPARED | SUBMITTING | SUBMISSION_RESULT_UNKNOWN | PENDING
CONFIRMED | REVERTED | NOT_FOUND | PARTIALLY_FILLED | SETTLED
EXPIRED | CANCELLED | REFUND_PENDING | REFUNDED | RECONCILIATION_REQUIRED
```

Every attempt is assigned an `executionAttemptId` and persisted before external submission.

### 12.2 Failure policies

| Policy | Behavior |
|---|---|
| ABORT | Stop before the next irreversible action |
| RETRY | Repeat the same bounded action with idempotency protection |
| REQUOTE_WITHIN_LIMITS | Accept a new route only inside manifest limits |
| PAUSE_FOR_APPROVAL | Require a new user decision |
| CANCEL_IF_AVAILABLE | Cancel an open order only when the execution mechanism supports it |
| REQUEST_REFUND | Invoke a supported bridge or solver refund path without claiming success before settlement |
| COMPENSATE | Execute a separately authorized reversal or risk-reduction action |

### 12.3 Recovery requirements

- persist state independently from the browser session;
- reconcile source and destination receipts, intents, orders, deposit IDs, nonces and protocol state;
- prevent duplicate execution;
- expose the best-known location and verification status of funds;
- preserve the manifest hash across retries;
- never select a materially different route without authorization;
- provide manual recovery instructions when automatic recovery is unavailable;
- inspect an attempt before issuing a replacement after timeout or lost response;
- treat late bridge arrival after policy expiry as recovery input, not automatic permission to continue;
- distinguish a completed bridge followed by destination failure from rollback;
- record balances, allowances, debt, positions, fees and residual assets after partial completion;
- prevent recovery from increasing authority beyond the original policy.

---

## 13. System architecture

### 13.1 Components

1. **Chat and Canvas UI:** synchronized strategy authoring.
2. **Intent Planner:** proposes typed nodes and asks for missing information.
3. **Workflow Compiler:** validates and produces canonical Semantic Workflow IR revisions.
4. **Action Registry:** schemas and capabilities for every adapter.
5. **Data and Quote Layer:** produces Quote and State Artifacts with routes, protocol state, price and provenance.
6. **Review Engine:** deterministic lint plus AI explanation.
7. **Simulation Orchestrator:** produces Simulation Bundles for sequential and failure-path analysis.
8. **Policy Compiler:** derives bounded Authorization Policy from the semantic plan and reviewed artifacts.
9. **Manifest Service:** canonicalizes and hashes plan, artifacts, simulation, policy, mode and revocation metadata.
10. **Authority Adapter:** binds Mode A, B or C to the wallet, intent protocol, smart account, module, guard or verifier actually used.
11. **Execution Planner:** produces adapter-specific executable actions inside authorized bounds.
12. **Execution Orchestrator:** validates hierarchical state and dispatches idempotently.
13. **Execution Journal:** append-only workflow, segment, step and attempt transitions.
14. **Independent Reconciler:** verifies external effects without trusting worker memory or partner status.
15. **Chain/Protocol Adapters:** discover, quote, simulate, build, decode, submit, track and normalize actions.
16. **Monitor:** conditions, positions and alerts without implicit authority to mutate them.
17. **Evidence Store:** append-only Evidence Bundles and superseding verification results.
18. **Partner Gateway:** authenticates tenants, enforces quotas and exposes APIs, webhooks, widget and MCP.
19. **Template Registry:** versions templates, authorship, origin, policies and publication status.
20. **Execution Explorer:** lets users locate, understand and recover any execution through the original DApp.

### 13.2 Trust boundaries

- The model cannot sign or broadcast transactions.
- The model cannot provide trusted contract addresses.
- Adapters accept only typed, validated input.
- The Manifest describes authority; the effective enforcement mechanism constrains executor behavior.
- The wallet or smart account is the authorization boundary.
- External routes are untrusted until validated and simulated.
- Monitoring does not grant permission to mutate positions unless explicitly authorized.
- The partner interface and partner-provided content are untrusted context, not execution authority.
- Partner credentials authenticate the tenant but do not replace the wallet signature.
- Status displayed by a partner is a projection of the canonical state maintained by the Execution Orchestrator.
- The deterministic executor may submit authorized actions; the LLM has no key and no unrestricted submission path.
- A backend-compromise test must determine which limits remain effective outside application controls.

### 13.3 Adapter interface

Every adapter exposes:

- capability discovery;
- input/output schema;
- quote or state read;
- permission requirements;
- simulation;
- transaction or intent construction;
- payload or intent hash and authorization-mode compatibility;
- human-readable decoding;
- submission and status tracking;
- receipt normalization;
- reconciliation invariants;
- cancellation, refund and recovery capabilities;
- supported evidence levels and environment limitations.

---

## 14. Embedded distribution layer

### 14.1 Purpose

Allow partner platforms to offer multichain DeFi composition and execution inside their own user journeys while using the same verifiable engine as the original DApp.

> The partner distributes the experience. Gryloo compiles, simulates, constrains, executes, reconciles and proves.

The embedded layer is a B2B2C distribution and monetization strategy. It is not a separate product, does not fork the Semantic Workflow IR and does not make the partner a custodian by default.

### 14.2 Integration surfaces

| Surface | Primary use | Visual control | Financial authorization |
|---|---|---|---|
| Hosted widget | Fast integration into websites and apps | Limited themes and components | User wallet |
| Headless SDK | Partner-owned UX | High, within the partner design system | User wallet |
| API | Backend, quotes, simulation, status and templates | Not applicable | Never by API key alone |
| MCP | Agents create, explain and track workflows | Agent client | Approval outside the model, on a trusted surface |

The widget is the reference integration. SDK, API and MCP share the same contracts and authority boundaries.

### 14.3 Canonical partner journey

1. The partner publishes or selects a versioned Strategy Template.
2. The user opens the template inside the partner's website.
3. The integration collects the amount, wallet and permitted preferences.
4. The engine instantiates a user-specific Semantic Workflow IR.
5. Quotes and state are retrieved with provenance and validity windows.
6. The workflow is reviewed and simulated end to end.
7. The system generates an individual Strategy Manifest.
8. The user reviews and signs on a trusted surface.
9. The Execution Orchestrator executes, reconciles and emits events.
10. The partner displays status, and the original DApp can open the same execution.

A recommendation in a livestream, post or report never authorizes execution. It may link to a template; only the instance reviewed and signed by the user can execute.

### 14.4 Strategy Template

A template is a parameterized recipe, not a pre-authorized transaction. It must include:

- identifier, name and description;
- author, partner and originating tenant;
- semantic version and publication date;
- base Semantic Workflow IR and schema version;
- permitted networks, protocols, assets and contracts;
- fixed and editable parameters, including editing limits;
- assumptions, risks, sources and validity window;
- default recovery policy;
- hash of the published content;
- status: draft, review, published, suspended or deprecated.

Any material change creates a new version. Existing executions remain bound to their original version. The Template ID never replaces the hash of the individual Manifest.

### 14.5 Execution identity and traceability

Every material execution attempt receives a **global Execution ID**, created before the first onchain submission. The canonical record contains:

```text
Execution ID: FD-4821
Origin: embedded_partner
Partner: 4P Finance
Template: 4P-AAVE-LP-v1.3
Workflow Hash: 0x...
Manifest Hash: 0x...
Owner Wallets: [...]
Current State: DESTINATION_FUNDED
```

The Execution ID links:

- journey origin and partner session;
- template version;
- Semantic Workflow IR, review and simulation;
- signed Manifest and authorization mode;
- quotes, sources and timestamps;
- transaction hashes, intents and receipts;
- failures, retries, requotes, refunds and interventions;
- final reconciled state and residual assets.

The user accesses the execution in the original DApp by connecting the corresponding wallet and entering or opening the Execution ID. Identifiers grant no access by themselves; sensitive data requires proof of wallet control or an authorized authenticated session.

### 14.6 Integration contract

At a minimum, the gateway must provide:

- discovery of networks, assets, protocols and capabilities;
- template listing and instantiation;
- Semantic Workflow IR composition and validation;
- quote, review and simulation;
- Strategy Manifest creation;
- approval-request creation;
- state lookup by Execution ID;
- pause, retry, refund or recovery requests when permitted;
- signed, re-queryable webhooks;
- a secure deep link to the Execution Explorer.

Minimum events:

```text
workflow.created
simulation.completed
manifest.ready
approval.requested
execution.started
step.confirmed
execution.paused
recovery.required
execution.completed
execution.failed
```

Webhooks are notifications, not the sole source of truth. Partners must be able to query state again, and events must include a signature, sequence number, idempotency key and replay protection.

### 14.7 Permitted MCP tools

MCP exposes narrow, typed tools such as:

- `get_supported_networks`;
- `get_supported_assets`;
- `quote_route`;
- `compose_strategy`;
- `simulate_strategy`;
- `review_strategy`;
- `create_strategy_manifest`;
- `request_user_approval`;
- `get_execution_status`;
- `recover_execution`.

MCP receives no private keys and exposes no `send_arbitrary_transaction` tool. Tool outputs, partner content and retrieved text are treated as untrusted data. The model may propose intents; the compiler, policies, simulation, Manifest and wallet determine what may execute.

### 14.8 Responsibilities

| Party | Primary responsibility |
|---|---|
| Gryloo | Compilation, schemas, simulation, Manifest, orchestration, reconciliation and evidence |
| Partner | Offer context, communication, template curation, tenant identity and agreed first-line support |
| User | Parameter selection, understanding of risks and wallet authorization |
| Protocols/routes | Primitive execution, liquidity and protocol-specific settlement/refund mechanisms |

Commercial agreements and terms of use must define support, incidents, data retention, content responsibility, authorized integrations and regulatory obligations. The interface must not conceal which party published the strategy or which infrastructure executes each step.

### 14.9 Example: partner-recommended strategy

A 4P Finance executive presents a lending-and-liquidity entry strategy in a livestream. The 4P page displays the verified template. The user selects amount, network and limits; the engine compiles the instance, refreshes quotes, simulates it and generates the Manifest. After signature, the execution appears both on 4P and in the original DApp under the same Execution ID.

If the bridge is delayed or the destination step fails, the partner displays the received status. The user can open the Execution Explorer, locate the funds, inspect evidence and select a recovery compatible with the Manifest. Unavailability of the partner interface must not erase the history or make it unrecoverable.

---

## 15. v3.2 adapters and networks

### 15.1 Action coverage

| Capability | v3.2 approach |
|---|---|
| Same-chain swap | Uniswap direct transaction first; CoW as a separate signed-intent lifecycle; compare only after independent certification |
| Bridge/cross-chain swap | LI.FI routed adapter first; direct Across adapter independently certified; never treat Jumper as infrastructure |
| Lending | Aave V3 supply, borrow and repay on one supported EVM network |
| Liquidity | Uniswap v3/v4 concentrated-liquidity entry on one EVM network |
| Solana swap | Jupiter adapter |
| Solana liquidity | One of Orca or Raydium after Jupiter and liquidity contracts are stable |
| Monitoring | Balance, bridge status, range and Aave health factor with observation-only authority by default |

### 15.2 Network priority

- Base or Arbitrum for mature EVM execution.
- Robinhood Chain for a Colosseum-relevant EVM deployment and programmable-wallet story, subject to route availability.
- Solana for non-EVM portability.
- Ethereum and Tempo as configuration or stretch networks.

The team must confirm contest-track eligibility independently. Technical support does not guarantee prize eligibility.

### 15.3 Infrastructure strategy

Use routing and protocol infrastructure as interchangeable adapters. Do not rebuild a bridge aggregator or solver network during the hackathon.

---

## 16. Authorization model

### 16.1 Mode A - Exact transaction, batch or intent authorization

Mode A is the first executable path and safest default. The user signs the exact final payload, atomic batch or protocol intent after human-readable decoding. If subsequent steps require different payloads and no delegated mechanism exists, additional signatures are disclosed rather than hidden.

Mode A proves payload fidelity, not general policy enforcement. Its strongest claim is:

> The reviewed payload is the authorized payload.

### 16.2 Mode B - Finite delegated execution

Mode B is mandatory for at least one complete v3.2 workflow. The user authorizes a finite plan and bounded executor identity. The enforcement mechanism must constrain the effective call path, not merely the normal application UI.

The selected implementation is recorded in an ADR containing:

- chain and account type;
- owners and thresholds;
- module, guard, verifier, role or intent protocol with exact version and deployment;
- principal executor and key-management boundary;
- permitted targets, functions and parameter scopes;
- cumulative budget accounting and concurrency behavior;
- nonce, expiry and revocation mechanism;
- installation, upgrade, disablement and emergency procedures;
- bypass tests outside the application;
- external audits and remaining unimplemented limits.

Do not create a custom high-authority module merely for convenience when an established, adequately scoped mechanism can prove the same requirement.

### 16.3 Mode C - Bounded recurring automation

Mode C extends certified Mode B with recurrence or conditional triggers. It adds:

- maximum frequency and cooldown;
- total and per-period budgets;
- maximum duration;
- permitted conditions and data sources;
- concurrent reservation rules;
- monitoring and expiry behavior;
- explicit revocation and emergency stop.

Mode C never grants unrestricted portfolio discretion and cannot silently expand itself.

### 16.4 Authorization rules

- never request or store the user's private key;
- keep LLM identity separate from deterministic executor identity;
- avoid unlimited allowances and overbroad session keys;
- show effective spender, recipient, target, function, value, chain and authorization mode;
- bind signatures to domain, chain, nonce, expiration and the actual signed payload, intent or enforceable policy;
- distinguish local pause from confirmed revocation;
- display all remaining allowances, modules, sessions, intents and cancellable orders;
- require new approval for material changes;
- distinguish onchain, wallet, protocol, application, monitor-only and unenforced limits;
- bind the authorization record to the Execution ID, semantic workflow, policy and Manifest hashes;
- prevent API key, partner session, webhook or MCP call from authorizing financial movement;
- require a new Manifest when partner, template, recipient or any non-preauthorized material parameter changes;
- display the strategy's origin without treating partner reputation as a guarantee of outcome;
- reserve cumulative budgets atomically so concurrent attempts cannot overspend shared authority;
- fail closed when revocation, nonce, allowance or module state is uncertain.

---

## 17. Security requirements

### 17.1 Threats

- prompt injection changing strategy parameters;
- malicious workflow templates;
- fake tokens, pools and protocol contracts;
- wrong-chain or wrong-recipient signatures;
- stale quotes and state changes;
- approval and Permit2 abuse;
- bridge failure or compromised route;
- duplicate execution after retry;
- oracle manipulation;
- malicious callbacks or Uniswap hooks;
- destination gas failure;
- model hallucination about protocol capabilities;
- prompt injection or malicious content originating from the partner site, template or MCP;
- a compromised partner attempting to replace the template, token, recipient or deep link;
- webhook forgery, reordering or replay;
- cross-tenant data leakage, quota abuse and integration-key abuse;
- divergence between partner-displayed status and onchain state;
- phishing through a widget, domain or fake signing screen;
- a compromised backend or executor key attempting actions outside policy;
- overbroad or malicious smart-account module, guard, role or session permission;
- a policy or Manifest hash recorded beside, but not bound to, the actual signature;
- concurrent attempts consuming the same budget;
- partial fills, late cross-chain arrival and revocation during pending execution;
- compensation or recovery that silently expands authority.

### 17.2 Mandatory controls

- typed schemas and allowlisted actions;
- verified chain, token, contract and adapter registries;
- canonical serialization before hashing;
- transaction decoding before signature;
- simulation immediately before authorization where possible;
- maximum spend and minimum output checks at execution time;
- idempotency keys and replay protection;
- exact allowance or bounded permit;
- quote freshness and deadline enforcement;
- independent monitoring and reconciliation;
- emergency pause and permission revocation;
- adversarial tests for every adapter and manifest rule;
- strict tenant isolation and rotatable credentials;
- Content Security Policy, permitted origins and widget integrity controls;
- webhook signing and replay protection;
- signed deep links or links reconstructed by the official domain;
- onchain reconciliation independent of the partner interface;
- separation between MCP planning tools and wallet approval;
- kill switches by adapter, template, partner and network;
- publication audit trails and rollback for compromised templates;
- ADR and pinned deployment for every Mode B or C enforcement mechanism;
- executor-key isolation, rotation and least authority;
- atomic budget reservation and release;
- bypass tests performed outside the frontend and normal API happy path;
- independent policy-to-payload validation immediately before submission;
- tests proving that wrong receiver, token, chain, target, function, amount, replay, expiry and revoked authority fail at the effective boundary;
- evidence labels that distinguish mocked, fork-reproduced, testnet-executed and mainnet-executed behavior.

### 17.3 SolVerdict relationship

SolVerdict remains independent. It can later attack workflows, prompts, adapters and Manifest enforcement as a security/regression service. Gryloo must remain usable without it.

---

## 18. Global regulatory posture

User signature and self-custody reduce certain risks but do not automatically eliminate regulatory obligations. Classification depends on custody, discretion, recommendations, transaction flow, marketing, fees, target jurisdictions and assets.

### 18.1 Lower-risk initial posture

- user defines the objective or explicitly accepts every suggested material change;
- user controls wallets and destination accounts;
- no pooled funds or custody;
- no guaranteed returns;
- route comparison uses disclosed objective criteria;
- AI review explains risk rather than declaring a best investment;
- transaction-specific or bounded authorization;
- no performance fee in the initial releases;
- controlled mainnet limits and clear risk disclosures;
- partners may distribute and contextualize templates, but the interface identifies authorship, risks and commercial conflicts;
- integration agreements do not imply custody or discretionary authority.

### 18.2 Escalation triggers

- personalized investment selection;
- discretionary portfolio changes;
- ability to move assets without bounded authorization;
- custody, money transmission or fiat handling;
- derivatives, margin or securities workflows;
- performance-based compensation;
- targeting restricted jurisdictions or sanctioned users;
- a partner promoting a regulated asset, a specific return or personalized advice;
- revenue sharing tied to the strategy's financial performance;
- fiat, payments or identity integrations that alter the regulatory role of the parties.

### 18.3 Launch requirement

Public commercial mainnet launch requires jurisdiction-specific legal review, sanctions and screening analysis, privacy review, consumer disclosures and a clear incident process. Open-source code and user signatures do not remove these obligations.

This specification is not legal advice.

---

## 19. v3.2 product scope

### 19.1 Core engine release — must ship

- synchronized chat and visual canvas over one Semantic Workflow IR revision;
- mandatory artifact separation and canonical hashes defined in Section 7;
- typed Action Registry and adapter conformance suite;
- deterministic linter and AI-assisted review;
- chained Simulation Bundles and source display;
- Authorization Policy, Strategy Manifest and enforcement matrix;
- Mode A exact-payload execution through Uniswap;
- Mode B finite delegated execution for at least one composed EVM workflow;
- CoW as a separately certified signed-intent lifecycle;
- LI.FI bridge path and separately certified direct Across adapter;
- Uniswap concentrated-liquidity add and remove lifecycle;
- Aave V3 supply, borrow and repay with account-wide health-factor checkpoints;
- first compositions: swap to liquidity, bridge to swap, cross-chain liquidity and lending downstream action;
- Jupiter swap and one of Orca or Raydium after the relevant gates;
- recoverable hierarchical execution with Execution Journal and independent reconciliation;
- monitoring and Evidence Bundles;
- honest evidence maturity labels;
- public documentation and reproducible demonstrations.

### 19.2 Bounded automation release — must follow Mode B certification

- one Mode C automation with explicit trigger, frequency, duration and budget;
- installation, inspection and confirmed revocation of delegated authority;
- concurrent budget reservation and replay protection;
- monitoring that cannot silently mutate positions outside the policy;
- adversarial proof against authority expansion.

### 19.3 Embedded platform release — must ship on the same engine

- global Execution ID and Execution Explorer in the original Gryloo DApp;
- versioned Strategy Templates with authorship and content hashes;
- reference widget able to load, simulate, authorize and track a template;
- headless SDK using the same contracts;
- API and MCP for discovery, composition, simulation, approval requests and status, but never arbitrary transaction submission;
- status API plus signed, idempotent and re-queryable webhooks;
- partner deep link to the same execution in the DApp;
- continuity proof when a partner interface is unavailable;
- partner console for publishing, suspending and versioning templates;
- tenant limits, isolation, telemetry and an integration audit trail.

### 19.4 Extended capabilities

- workflow import and export;
- additional EVM and Solana adapters after conformance;
- private execution or MEV protection;
- arbitrage detection and simulation;
- separately authorized compensation actions;
- self-service integration sandbox;
- aggregate conversion and completion analytics by template;
- additional bounded Mode C policies after security and regulatory review.

### 19.5 Explicitly deferred

- unrestricted autonomous trading;
- live competitive arbitrage as a core promise;
- every chain and protocol;
- derivatives/perpetuals;
- open strategy marketplace;
- fiat custody and on/off-ramp;
- performance fees;
- unreviewed third-party adapters;
- automatic strategy selection for the user;
- open, permissionless marketplace of partners or templates;
- MCP execution without external user confirmation;
- white-label deployments that completely conceal the origin of the engine or evidence;
- transfer of custody or private keys to a partner;
- continuous automation with broad, self-expanding or unbounded authority.

---

## 20. Colosseum demo

### Demo 1 - Beginner

1. User asks to swap USDC to ETH.
2. Gryloo compares Uniswap and, when independently certified, CoW by disclosed net-result criteria.
3. User reviews the Semantic Workflow IR, artifacts, Simulation Bundle and decoded Mode A payload or intent.
4. User signs and receives reconciled execution evidence.

### Demo 2 - Bounded authority

1. User creates a finite USDC to Uniswap liquidity workflow through chat and confirms the same plan on canvas.
2. Gryloo calculates the token composition for the approved range rather than assuming 50/50.
3. The user installs or signs bounded Mode B authority with target, function, asset, amount, recipient, nonce and expiry limits.
4. The browser closes and the deterministic executor completes the permitted workflow.
5. A separate attempt changes the recipient or exceeds the cumulative budget and fails at the effective enforcement boundary.
6. The user returns to inspect position ownership, spent amounts, fees, residual assets, permissions and Evidence Bundle.

### Demo 3 - Cross-chain recovery

1. User asks to move USDC from Base and enter an ETH/USDC pool on the destination chain.
2. Chat constructs bridge -> split -> swap -> add-liquidity nodes.
3. Canvas updates in real time.
4. User chooses a plus/minus 10% range.
5. A delayed bridge and expired destination quote demonstrate reconciliation, policy expiry and bounded requote.
6. User signs the Strategy Manifest.
7. Execution Journal and Evidence Bundle identify every attempt, asset location, fee and residual effect.

### Demo 4 - Advanced lending

1. User manually adds Aave supply and borrow nodes.
2. User adds swap and liquidity nodes through chat.
3. Review detects an unsafe health factor and missing recovery step.
4. User accepts corrected limits.
5. Manifest diff proves exactly what changed.
6. Gryloo clearly separates the execution-time health-factor check from continuing monitoring and does not promise prevention of future liquidation.

### Demo 5 - Solana portability

1. The same semantic swap action is authored through chat or canvas.
2. Gryloo resolves it to Jupiter through a Solana-specific adapter without creating a second product architecture.
3. Authorization, simulation, execution states and reconciliation expose the differences between EVM and Solana.
4. One Orca or Raydium liquidity path follows only after its isolated gates pass.

### Demo 6 - Embedded distribution

1. A partner website opens a versioned strategy template.
2. The user selects amount and limits without leaving the partner site.
3. The widget uses the same Semantic Workflow IR, Simulation Bundle and Manifest as the Gryloo DApp.
4. The wallet displays and signs authorization bound to the Manifest Hash.
5. The partner tracks events through the Execution ID.
6. A simulated failure requires recovery.
7. The user opens the original DApp and continues the exact same execution.

This demo proves the platform and distribution model without creating a parallel product. A submission video may select the strongest subset, but every statement must match the demonstrated evidence level.

### Demo message

> One strategy can be expressed in natural language or as a graph, reviewed as typed data, authorized as an exact payload or bounded policy, executed across protocols and independently reconciled without giving the LLM unrestricted authority.

---

## 21. Capability-based build program

The program is ordered by dependency and certification, not by team size or calendar weeks. Workstreams may develop in parallel after shared contracts are frozen. Certification and composition remain serial at dependency boundaries.

### Phase 0 - Constitution and decisions

- approve Gryloo naming and neutral protocol namespace rules;
- freeze artifact terminology and canonical identifiers;
- approve the Mode B authority ADR and threat model;
- freeze licensing map and contribution policy;
- define evidence maturity labels and release gates.

### Phase 1 - Semantic and evidence contracts

- implement Semantic Workflow IR, artifacts, Simulation Bundle, Policy, Manifest, Execution Plan, Journal and Evidence schemas;
- implement canonicalization, hashes, invalidation and compatibility fixtures;
- build synchronized chat/canvas with `baseRevision` conflict handling;
- implement Action Registry and deterministic linter.

### Phase 2 - First complete Mode A cycle

- execute Uniswap swap end to end;
- prove exact-payload review and authorization;
- persist before submission;
- reconcile receipt, balances, allowance, fees and recipient;
- survive unknown submission result and worker restart without duplication.

### Phase 3 - Bounded Mode B authority

- implement the approved established authority mechanism;
- prove browser-independent finite execution;
- test wrong receiver, token, chain, target, function, amount, replay, expiry and revoked authority outside the UI;
- expose remaining permissions and confirmed revocation.

### Phase 4 - EVM execution and composition

- certify CoW independently as a signed-intent lifecycle;
- certify Uniswap add/remove liquidity with range-derived token composition;
- compose swap to liquidity under Mode B;
- prove propagated outputs, shared budgets, position ownership and residual reconciliation.

### Phase 5 - Cross-chain execution

- certify LI.FI routed bridge and direct Across independently;
- compose bridge to swap and cross-chain liquidity;
- test delayed arrival, expired destination policy, missing gas, partial completion, refund availability and provider outage;
- reconcile origin, provider and destination before continuation.

### Phase 6 - Lending and advanced composition

- certify Aave supply, borrow and repay separately;
- calculate health factor from complete account state and identified oracle data;
- compose lending with swap or liquidity;
- separate execution-time checks from continuing monitoring and Mode C defense.

### Phase 7 - Solana portability

- certify Jupiter through the shared semantic contracts;
- certify one of Orca or Raydium;
- document authorization, simulation, account, transaction and reconciliation differences without creating a separate architecture.

### Phase 8 - Mode C automation

- implement one narrow recurring or conditional policy after Mode B certification;
- prove frequency, duration, cumulative budget, concurrency and revocation;
- test authority expansion attempts and monitoring failure.

### Phase 9 - Embedded distribution

- deliver Strategy Templates, widget, SDK, API, MCP, Partner Gateway and console;
- prove tenant isolation, signed webhooks and partner unavailability recovery;
- show the same Execution ID, canonical state and Evidence Bundle in partner and Gryloo DApp surfaces.

### Phase 10 - Hardening and public proof

- run adversarial, failure-path, replay, concurrency and recovery suites;
- test with beginner, intermediate and advanced users;
- publish schemas, limitations, environment labels and reproducible evidence;
- complete security, legal, license and mainnet release gates.

---

## 22. Acceptance criteria

The v3.2 implementation is accepted when:

- chat and canvas round-trip against `baseRevision` without losing parameters or silently overwriting conflicts;
- Semantic Workflow IR, Artifact Set, Simulation, Policy, Manifest, payload or intent, attempts and Evidence Bundles have distinct canonical identifiers and hashes;
- mutable runtime state cannot silently change or preserve authorization;
- every executable node has a typed schema and independently verified adapter;
- the canonical workflows compile from the same semantic contracts;
- simulation propagates outputs and resource consumption across dependent nodes without double spending;
- liquidity token composition is calculated from the approved range, ticks and price rather than assumed to be 50/50;
- health-factor checks identify account scope, oracle data and evaluation checkpoint without promising future protection;
- Mode A proves exact payload, batch or intent fidelity;
- at least one Mode B finite strategy completes with the browser closed and after worker restart;
- Mode B rejects wrong receiver, token, chain, target, function, amount, replay, expiry and revoked authority outside the normal UI;
- one Mode C policy proves frequency, duration, budget, concurrency and confirmed revocation after Mode B certification;
- every limit is labeled by enforcement location, including `NOT_ENFORCED` when applicable;
- cross-chain state persists through page refresh, worker restart and partner unavailability;
- a delayed or late bridge triggers reconciliation and the configured policy;
- an unknown submission result cannot cause duplicate effects;
- every transaction or intent is human-readable before signature;
- reconciliation verifies receipts or settlements plus balances, allowances, debt, position ownership, fees and residual assets;
- evidence distinguishes confirmed, reconciled, inconclusive and divergent outcomes;
- every proof is labeled `MOCKED`, `FORK_REPRODUCED`, `TESTNET_EXECUTED` or `MAINNET_EXECUTED`;
- EVM and Solana paths are executed or reproduced in an explicitly identified official environment;
- partner and Gryloo DApp display the same canonical state for the same Execution ID;
- a published template cannot change without a new version and content hash;
- an API key, partner session, webhook or MCP call cannot move funds without wallet or previously bounded authority;
- duplicate or out-of-order webhooks do not alter canonical state;
- the user can recover in the Gryloo DApp an execution initiated through a partner;
- logs and tests demonstrate isolation between at least two tenants;
- public documentation discloses limitations, setup signatures, active permissions, revocation procedures and unsupported guarantees.

---

## 23. Success metrics

### Product

- intent-to-valid-workflow rate;
- canvas/chat round-trip accuracy;
- time to first executable strategy;
- simulation-to-authorization conversion;
- percentage of AI suggestions accepted or rejected;
- workflow completion rate;
- time and steps saved versus executing the same workflow manually;
- percentage of users who can explain budget, authority, recovery and revocation before authorization.

### Safety

- unsafe workflows blocked;
- manifest-policy violations prevented;
- wrong-chain, recipient or token incidents;
- simulation versus realized output error;
- stale quote rejection;
- unauthorized execution count;
- duplicate action count;
- policy bypass attempts blocked at application and independent enforcement boundaries;
- active permissions left after workflow completion;
- cumulative-budget reservation conflicts and overspend count;
- percentage of material rules enforced outside the application.

### Recovery

- workflows resumed successfully;
- mean time to detect stalled step;
- mean time to recover or refund;
- percentage of failures with clear fund location;
- unknown-submission outcomes resolved without duplication;
- percentage of completed attempts independently reconciled;
- inconclusive and divergent Evidence Bundles.

### Platform

- adapters passing conformance tests;
- reusable workflows imported;
- external API/MCP calls;
- protocols and chains with verified evidence;
- active partners and time to first integration;
- workflows initiated by surface: DApp, widget, SDK, API and MCP;
- conversion from opened template to simulation, signature and completion;
- percentage of embedded executions opened in the Execution Explorer;
- webhook latency, delivery and re-query rates;
- tenant-isolation incidents and violations.

---

## 24. Differentiation and moat

### Not defensible alone

- natural-language swaps;
- bridge aggregation;
- one-click LP entry;
- visual recipes;
- generic MCP tools;
- AI-generated strategy suggestions;
- intent compilation;
- Safe-based agent execution or protocol allowlists by themselves;
- a Manifest hash without independent enforcement and reconciliation.

### Core differentiation

1. Bidirectional no-code chat and typed financial canvas over one revisioned semantic plan.
2. User-authored strategies rather than only predefined intents.
3. Explicit separation of semantic plan, observed state, simulation, policy, execution attempts and evidence.
4. Mode-aware authorization that distinguishes exact payloads from finite delegation and recurring automation.
5. Strategy Manifest plus an enforcement matrix that does not overclaim application controls.
6. Chained multichain simulation with propagated outputs, budgets and failure paths.
7. Failure-aware, recoverable orchestration with independent reconciliation.
8. Evidence from intent to business outcome, not merely transaction confirmation.
9. Canonical continuity between the Gryloo DApp and embedded surfaces.
10. Versioned partner templates that generate individual Manifests rather than generic permissions.

### Long-term moat

- open but widely adopted Semantic Workflow IR, artifact and Manifest formats;
- audited adapter conformance suite;
- dataset of simulations, failures and recovery outcomes;
- library of verifiable policy primitives;
- wallet and agent distribution through SDK/MCP;
- portable strategies mapped to equivalent actions across ecosystems;
- a distribution network spanning wallets, fintechs, on/off-ramps and crypto platforms;
- an operational reliability history by template, adapter, route and partner;
- a canonical evidence contract that follows users across surfaces.

The moat is not the model or prompt. It is the verified compiler, enforcement and execution history.

---

## 25. Business model

The commercial model has two channels built on the same infrastructure. The direct channel validates product and trust with end users. The embedded channel sells distribution, infrastructure, reliability and support to companies that already have an audience.

### 25.1 Direct channel - Original DApp

- free tier for basic swaps and simulations;
- Pro subscription for advanced workflows, monitoring, templates and recovery;
- a possible, clearly disclosed execution fee when competitive and legally appropriate;
- premium history, alerts, bounded automation and evidence features.

The DApp is not merely an acquisition funnel. It is the complete product surface and the canonical center for tracking and recovery.

### 25.2 Embedded channel - B2B2C

Potential commercial components, to validate with design partners:

- **platform license:** monthly fee per tenant, environment and capability set;
- **usage:** pricing per intensive simulation, workflow initiated, execution completed or volume processed;
- **SLA and operations:** monitoring, support, evidence retention and managed recovery;
- **customization:** dedicated integration, adapters, policies, templates and UX components;
- **revenue share:** only when transparent, legally appropriate and free from hidden routing incentives;
- **enterprise:** dedicated isolation, controls, auditability, analytics and contractual support.

### 25.3 Unit of value

The partner is not merely buying API calls. It is buying:

- multichain DeFi capabilities without having to build orchestration, simulation and recovery;
- higher conversion from content or recommendation into an authorized action;
- retention of the user within the partner experience;
- fewer operational failures and less manual support;
- a verifiable trail for investigating complaints and incidents;
- progressive integration: widget first, then SDK/API.

### 25.4 Pricing principles

- do not charge the user twice without clear disclosure;
- separate protocol, gas, bridge, routing and platform fees;
- do not choose an inferior route because it pays more;
- offer a minimum monthly commitment or included allowance to cover fixed integration and support costs;
- tie usage pricing to an auditable event, preferably a completed workflow or actually executed volume;
- do not promise final pricing before measuring simulation, RPC, indexing, support and recovery costs.

### 25.5 Initial commercial hypothesis

For validation, prioritize two or three design partners with crypto audiences and one clear recurring strategy. Offer a limited-scope reference integration, measure conversion and operating cost, and only then choose a license, usage or hybrid model.

Avoid performance fees, opaque order-flow sales and discretionary management at launch.

---

## 26. Open-source strategy

Use an open-core model with explicit per-package licensing.

### 26.1 Apache-2.0 integration and standardization layer

- Semantic Workflow IR and artifact schemas;
- Strategy Manifest schema;
- public Action Registry contracts;
- adapter interfaces and conformance tests;
- public API and event contracts;
- sample adapters and templates;
- local verification tools.

### 26.2 AGPL-3.0-only public implementation

- Gryloo reference DApp;
- reference compiler and linter;
- reference simulation engine;
- local/reference executor and reconciler;
- local/reference evidence pipeline;
- public product UI components.

### 26.3 Proprietary or private managed layer

- managed monitoring and recovery workers;
- optimized routing and data reliability;
- enterprise policy administration;
- audit evidence retention;
- premium adapter and support SLAs;
- Partner Gateway, multi-tenant isolation and credential management;
- template console, analytics and managed webhooks;
- hosted Execution Explorer, extended retention and incident support.

### 26.4 License governance

- every package carries an identifiable SPDX license;
- root `LICENSE`, package licenses, `NOTICE` and `docs/LICENSE_MAP.md` remain consistent;
- CI produces a dependency and license inventory;
- dependency compatibility is reviewed before merge;
- external contributions use an approved CLA if future dual licensing is required;
- founders formalize IP ownership outside the repository;
- the Apache and AGPL licenses grant no right to use the Gryloo name, logo or visual identity;
- maintain `TRADEMARKS.md` for Gryloo;
- commercial licensing for AGPL-incompatible partners requires a separate approved agreement;
- directory placement alone never determines licensing without the corresponding legal files and package metadata.

This structure supports auditability and adoption while preserving managed operational advantages. It is an engineering and product policy, not legal advice; counsel should review dependency compatibility, CLA, dual licensing and trademark protection before commercial distribution.

---

## 27. Main risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Product becomes a generic agent | Critical | Lead with compiler, manifest and recovery |
| Parallel workstreams diverge from shared contracts | Critical | Freeze schemas, use compatibility fixtures and certify compositions serially |
| One-signature claim is technically false | High | Promise minimum signatures and disclose execution mode |
| Manifest is only cosmetic | Critical | Enforcement matrix plus certified Mode B boundary and bypass tests |
| Policy hash is stored but not actually signed or enforced | Critical | Typed-data or contract binding and signature-verification fixtures |
| Smart-account module or executor identity is overpowered | Critical | Established mechanism, pinned deployment, least authority, external review and revocation tests |
| Concurrent attempts overspend a shared budget | Critical | Atomic reservation, cumulative accounting and concurrency tests |
| Cross-chain workflow strands funds | Critical | State machine, fund location and recovery policies |
| AI changes material parameters | Critical | Locked nodes, manifest diff and new signature |
| Route provider becomes single point of failure | High | Adapter abstraction and fallback provider |
| Simulation creates false confidence | High | Scenarios, freshness and explicit limitations |
| Personalized suggestions create regulatory risk | High | User direction, objective data and legal review |
| Arbitrage distracts from the core product | Medium | Simulation only until execution infrastructure is credible |
| Embedded layer appears to be a second thesis | High | Present it only as distribution of the same v3 engine |
| Partner alters or misrepresents the strategy | Critical | Versioned template, visible authorship, content hash and individual Manifest |
| Compromised partner site induces a malicious signature | Critical | Permitted origins, decoded preview, trusted signing domain and Manifest enforcement |
| Status diverges between partner and DApp | High | One canonical state, ordered events and onchain reconciliation |
| Cross-tenant data leakage | Critical | Isolation, authorization tests, audit logs and separate secrets |
| Support responsibility becomes undefined | High | Contractual matrix, Execution ID and explicit handoff between partner and platform |
| Embedded surfaces drift from the Gryloo DApp | High | Same contracts, hashes, Execution ID, state and Evidence Bundle across every surface |
| Evidence overstates environment maturity | High | Mandatory mock, fork, testnet and mainnet labels |

---

## 28. Decision gates

### Gate 1 - Comprehension

Users can explain the workflow, authorization and recovery behavior before signing.

### Gate 2 - Artifact integrity

Chat, canvas, Semantic Workflow IR, artifacts, Simulation Bundle, Policy, Manifest, payloads, Journal and Evidence remain consistently linked under compatibility and hashing tests.

### Gate 3 - Mode A payload fidelity

The reviewed and decoded transaction, batch or intent is exactly what the wallet authorizes, and the reconciled result is linked back to it.

### Gate 4 - Mode B enforceability

At least one finite delegated workflow continues with the browser closed while unauthorized receiver, token, chain, target, function, amount, replay, expiry and revoked authority fail at the effective boundary.

### Gate 5 - Composition integrity

Real outputs feed dependent steps without double spending; native-unit budgets, gas reserves, allowances, position ownership and residual assets reconcile.

### Gate 6 - Recovery

The team can intentionally create an unknown submission result, partial completion and cross-chain failure and demonstrate reconciliation before safe continuation, retry, cancellation, refund request or intervention.

### Gate 7 - Cross-ecosystem portability

EVM and Solana adapters use the same semantic and evidence contracts while exposing their different authorization and transaction semantics.

### Gate 8 - Mode C bounded automation

One recurring or conditional policy proves frequency, duration, cumulative budget, concurrency, expiry and confirmed revocation without authority expansion.

### Gate 9 - Distribution integrity

The same Execution ID, Manifest, canonical state and Evidence Bundle appear on the partner surface and in the Gryloo DApp; partner unavailability does not prevent tracking or recovery.

### Gate 10 - Mainnet

Public mainnet operation requires external security review, capped exposure, incident procedures, monitoring reliability and jurisdiction-specific legal review.

---

## 29. Team recommendation

- **Product/full-stack:** chat, canvas and user experience.
- **Workflow/backend:** IR, compiler, manifest and state machine.
- **Authority:** Mode A/B/C mechanisms, smart accounts, intents, revocation and executor identity.
- **EVM/protocol:** routing, Aave, liquidity and smart-account enforcement.
- **Solana/protocol:** Jupiter/Orca adapter and wallet execution.
- **Security/risk:** simulation, policy tests and adversarial review.
- **Platform/partnerships:** widget, Partner Gateway, templates, webhooks, tenancy and design-partner integration.
- **Evidence/reliability:** Journal, reconciliation, failure injection and Evidence Bundles.
- **Open source/legal operations:** licenses, dependency policy, CLA, IP and release documentation.

Teams may work concurrently after contracts and ADRs are frozen. Parallel implementation never waives dependency gates: adapters, authority mechanisms and surfaces are independently certified before they enter a composed or public release. Use one shared requirement registry, compatibility corpus and evidence taxonomy across all workstreams.

---

## 30. Final recommendation

Build the full Gryloo product architecture and certify it through progressively composed workflows. Team capacity may increase parallel implementation, but it does not change trust dependencies or evidence requirements.

Do not position the product as:

- an AI chatbot for swaps;
- an n8n clone for crypto;
- a pool optimizer;
- an autonomous asset manager.

Position it as:

> **Gryloo — the verifiable workflow engine for multichain DeFi.**

Distribute it as:

> **One plan across chat and canvas. Bounded authority across chains. Evidence for every outcome.**

The strongest Colosseum narrative is not that the product integrates the most chains. It is that a user can freely design a sophisticated strategy, understand it, bind it to explicit authorization and watch it execute safely across fragmented financial infrastructure.

The embedded layer strengthens the business potential without changing that narrative: partners become distribution channels for the same Gryloo engine, while the original DApp remains the complete product and the canonical source of truth for the user.

---

## 31. References

- Colosseum Crypto World's Fair: <https://colosseum.com/worldsfair>
- Colosseum hackathon FAQ: <https://colosseum.com/hackathon>
- LI.FI architecture and capabilities: <https://docs.li.fi/introduction/introduction>
- Enso Shortcuts and bundled DeFi actions: <https://docs.enso.build/pages/build/examples/shortcuts>
- DeFi Saver Recipe Creator and automation: <https://defisaver.com/>
- ERC-7683 Cross Chain Intents: <https://eips.ethereum.org/EIPS/eip-7683>
- EIP-5792 Wallet Call API: <https://eips.ethereum.org/EIPS/eip-5792>
- ERC-4337 Account Abstraction: <https://eips.ethereum.org/EIPS/eip-4337>
- EIP-7702 Set Code for EOAs: <https://eips.ethereum.org/EIPS/eip-7702>
- Across developer documentation: <https://docs.across.to/>
- Aave developer documentation: <https://aave.com/docs/developers>
- Jupiter developer documentation: <https://dev.jup.ag/>
- Orca developer documentation: <https://docs.orca.so/>
- Almanak platform build documentation: <https://platform.docs.almanak.co/build.html>
- Almanak platform deployment and scoped permissions: <https://platform.docs.almanak.co/deploy.html>
- Safe smart-account modules: <https://docs.safe.global/advanced/smart-account-modules>
- Uniswap liquidity overview: <https://developers.uniswap.org/docs/liquidity/overview>
- Aave health factor and liquidations: <https://aave.com/help/borrowing/liquidations>
- Apache License 2.0: <https://www.apache.org/licenses/LICENSE-2.0>
- GNU Affero General Public License 3.0: <https://www.gnu.org/licenses/agpl-3.0.en.html>
- 4P Finance API documentation: <https://docs.4p.finance/>
- Model Context Protocol - Security Best Practices: <https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices>
- Model Context Protocol - Tools: <https://modelcontextprotocol.io/specification/2025-11-25/server/tools>
- Model Context Protocol - Elicitation: <https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation>

The team must revalidate protocol deployments, wallet capabilities, route coverage, contest rules and legal assumptions before submission and before public mainnet launch.
