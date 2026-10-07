# BUILD-COPILOT-002 — Plan: conversational Flofi Copilot

Date: 2026-10-05. Branch `claude/build-copilot-002`, from `origin/main` `d58b535` (BUILD-COPILOT-001 merged as PR #59).

> **The AI is still an untrusted natural-language interpreter with no financial authority.** This build lets it hold a
> bounded conversation, refer to existing steps, propose edits and classify read-only questions. Flofi resolves every
> reference, owns every value's provenance, writes every factual answer, and still needs an explicit **Apply**.

## 1. Inspection: what exists at `d58b535`

| Area | State |
| --- | --- |
| Interpretation | `parseLocalCommand` first. Unrecognized text goes to `copilotInterpret` (server action) → OpenAI Responses API, strict `CopilotIntentV1` → `copilotIntentToCommand` → canonical exact-grammar sentence → `parseLocalCommand` → `propose`. |
| Conversation | A clarification thread of at most 6 messages, cleared by any proposal, unsupported reply, failure or exact command. No references, no edits, no questions. |
| Grounding | Every amount, slippage, range bound and address must appear in the thread's user text. Test networks default when they are an action's only deployment; a test-network bridge pair completes itself. |
| Edit commands | `SET_SUPPLY/BORROW/REPAY/WITHDRAW`, `SET_SOLANA_SWAP`, `SET_ROUTER_BRIDGE`, `SET_UNISWAP_LIQUIDITY`, `SET_SOLANA_LIQUIDITY`, `SET_SWAP_AMOUNT`, `SET_SLIPPAGE`, `REMOVE`, and `AUTHOR_LENDING` (the lending inspectors re-author the composition). Every node has a `*Details` reader and most have an `*InputOf` writer. |
| Composition rules | Aave actions, Solana swap/liquidity and Uniswap liquidity are isolated (`*_ISOLATED_ONLY`). The Router replaces the workflow. The only multi-step lending shape is Supply → HF checkpoint → Borrow → Swap the borrowed USDC (`AUTHOR_LENDING`). `canDeleteCanvasNode` protects `node-001`, the last node, locked nodes and dependencies. |
| Read-only state in the browser | Canonical IR (`useWorkflow().state.workflow`), pending proposal and its deterministic diff, lint review (`ReviewResult.findings`), the mocked artifact chain status, and `useWorkflowCapability()` (environment, `executionSupported`, `executionReady`, evidence ceiling, per-node blockers such as `SIMULATION_REQUIRED`, `ARTIFACTS_STALE`, `AUTHORIZATION_REQUIRED`, `WALLET_NOT_CONNECTED`). Every IR node carries `failurePolicy` (always `ABORT` today) and `requiredAuthorizationClass` (`MODE_A`: the owner's wallet signs). |
| Free text in the IR | None. Node, action and chain identifiers are pattern-restricted; there are no labels or descriptions. |
| Panel | `copilot-panel.tsx` dismisses the pending proposal before it calls the AI path. |

No new protocol, execution path, wallet capability or chat framework is needed.

## 2. Architecture

```
user text
 ├─ "explain" / exact grammar → parseLocalCommand → Command                          (unchanged, first, no model)
 ├─ secret guard: private key / seed phrase / 64-hex secret → local refusal          (never sent, never stored)
 ├─ open Flofi question + reply is one of Flofi's own options or a bare amount
 │     → deterministic slot fill                                                    (no model)
 └─ otherwise → server action copilotInterpret({ version: '2', messages })           (bounded transcript)
        → OpenAI Responses API, strict CopilotIntentV2 (no tools, store:false)
        → parseCopilotIntentV2 (server, then again in the browser)
        → conversation engine (pure, browser):
             ACTION / COMPOSITION → V1 planners (+ explicit reuse with provenance)  → exact grammar → ADD_* / AUTHOR_LENDING
             EDIT                 → resolve target → planners → exact grammar → typed edit command (SET_*, AUTHOR_LENDING)
             REPEAT               → resolve referent → planners → exact grammar → ADD_*
             REMOVE               → resolve target → REMOVE (canDeleteCanvasNode)
             INSERT               → resolve anchor → explained against the existing composition rules
             QUESTION             → Flofi-written answer from Flofi state                (read only)
             CLARIFICATION / UNSUPPORTED → sanitized display text
        → editor preview (reject unappliable proposals with an explanation)
        → propose(command) → diff + lint → explicit Apply → canonical IR → Manifest → Simulate → Review → wallet → …
```

The model never sees the workflow. It reports what the user said (step type, ordinal, values), and Flofi resolves
that against the current canonical state. Factual answers are written by Flofi from Flofi state; the model only picks
the question's topic. This removes the workflow as a prompt-injection surface and keeps wallet addresses out of the
model request.

### New and changed files

| File | Change |
| --- | --- |
| `src/domain/workflow-steps.ts` | New, AI-agnostic. Ordered typed step descriptors for the canonical IR (kind, protocol, network, assets, amounts, slippage, recipient, failure policy, authorization class), built from the existing `*Details` readers. |
| `src/domain/workflow-edits.ts` | New, AI-agnostic. `editCommandFor(workflow, nodeId, authoring)`: turns a validated authoring command for the same kind of step into the existing edit command for that node (`SET_*`, `SET_SWAP_AMOUNT`/`SET_SLIPPAGE`, `AUTHOR_LENDING`). `removeCommandFor`. No IR mutation; the reducer still does that. |
| `src/domain/copilot-intent-v2.ts` | New. `CopilotIntentV2` types, limits, strict parser, structured-output schema. Reuses the V1 action shapes. |
| `src/domain/copilot-messages.ts` | New. English and Portuguese copy for every Copilot reply. English matches V1 exactly. |
| `src/domain/copilot-authoring.ts` | Planners take a grounding context (`text`, carried fields with provenance, language, network policy). `copilotIntentToCommand` (V1) keeps its signature and behavior. |
| `src/domain/copilot-conversation.ts` | New. The pure conversation engine: bounded transcript, open request segment, Flofi drafts, referents, fingerprints, target resolution, secret guard, slot filling, dispatch per intent kind. No React, no network. |
| `src/domain/copilot-answers.ts` | New. Read-only answers (EN/PT) from `CopilotFacts`. |
| `src/server/copilot-service.ts` | Adds the V2 request validator, instructions, request builder, response reader with usage, configurable timeout / output budget / reasoning effort, `Retry-After`, telemetry records, and the V2 replay key. V1 functions unchanged. |
| `src/app/copilot-action.ts` | Dispatches V1 / V2 requests; metadata-only telemetry sink. |
| `src/components/copilot-ai.tsx` | The hook drives the engine and builds `CopilotFacts` from the stores. Same exports. |
| `src/components/copilot-panel.tsx` | One functional change: the AI path no longer dismisses the pending proposal before interpreting (needed for "make it 2" and questions about the proposal). Off mode is unchanged. |
| `e2e/copilot/replay-v2.json`, `e2e/copilot-conversation.spec.ts` | New replay answers and browser journeys. `copilot.spec.ts` moves to V2 replay. |
| `src/**/copilot-*.test.ts`, `src/domain/workflow-*.test.ts`, `src/domain/copilot-eval*.ts` | Unit tests and the deterministic eval corpus. |
| `src/server/copilot-live.live.test.ts` | Owner-triggered live smoke test, excluded from `pnpm test`. |
| `package.json` | `test` excludes `*.live.test.ts`; new `test:copilot-live`. |
| `.github/workflows/contracts.yml` | The existing Copilot browser line also runs the new spec. |

`globals.css` is not changed. No dependency is added.

## 3. Trust boundary (unchanged) and what is new

The model gets no tool, no workflow, no wallet and no state. Its output is `{ "intent": CopilotIntentV2 }` and nothing
else. Every Command the Copilot can produce is either:

* a new authoring command produced by `parseLocalCommand` from a sentence Flofi rendered (V1 invariant), or
* an existing edit command (`SET_*`, `REMOVE`, `AUTHOR_LENDING`) for a node Flofi resolved, whose values went through the
  same planners and exact grammar first.

Allowed command types are a closed list. `LOCK`, `CONNECT`, `DISCONNECT`, `REMOVE_MANY`, template `ADD`, `SET_AMOUNT`,
CoW, Robinhood and the legacy compositions are never produced. `source` is `CHAT`, `baseRevision` is the current
revision, `commandIsValid` holds, and the editor preview must accept it. The workflow changes only through
`applyProposal`.

## 4. Conversation model and bounds

| Bound | Value |
| --- | --- |
| Transcript sent to the model | ≤ 16 messages, ≤ 8 user turns, starts and ends with the user, ≤ 12,000 characters |
| User message / Flofi transcript entry | ≤ 1,024 / ≤ 600 characters, no control or bidirectional characters |
| Open request segment | ≤ 6 user messages |
| Clarifications per request | ≤ 3, then Flofi asks for the whole request in one message |
| Referents (recent proposals Flofi showed) | ≤ 4 |
| Model output text | ≤ 8 KiB; response body ≤ 256 KiB |

Flofi's transcript entries are short, Flofi-written summaries (`Flofi proposed: …`, `Flofi asked: …`,
`Flofi answered a question (…)`). Read-only answers are not copied into the transcript.

The **open request segment** is the user's messages since the last proposal, answer or refusal (the V1 thread).
Explicit values must be grounded in it, exactly as in V1. Earlier messages are context for the model only.

## 5. Provenance

Every financially relevant value has one of these sources, checked deterministically:

1. **The open request** — the V1 grounding rules (digits, percent slippage, typed addresses, named assets and
   networks).
2. **A resolved referent** — a step of the canonical workflow, the visible pending proposal, or a recent proposal Flofi
   showed. Values are read from the IR or the Command, never from the model.
   * `EDIT`: unchanged fields come from the target.
   * `REPEAT` ("do the same thing but with 2 USDC"): fields come from the referent, and the request must contain a reuse
     cue (`same`, `again`, `mesmo`, `de novo`, …).
   * `ACTION` with `reuse` ("supply 2 USDC on the same network"): only the named fields are carried, each needs a reuse
     cue, and the referent must be unique.
3. **Connected wallet** — only where the exact grammar already uses it (Aave beneficiary, lending owner).
4. **Existing Flofi defaults** — slippage and automatic routing, shown as notes.

The model is never a source. A value the model reports that is neither in the open request nor carried from a resolved
referent becomes a clarification ("make it smaller" cannot become 2). Carried values are listed in the reply ("Kept from
step 2: network Base Sepolia, token USDC").

**Network policy (intentional change for V2).** Following the owner's examples ("Which network?", "Where should it
go?"), V2 no longer defaults a network or completes a bridge pair. It asks, offering the supported networks as buttons.
V1 conversion keeps its defaults and is still tested.

## 6. Reference and edit resolution

The model describes a target only as `{ step: SWAP|BRIDGE|SUPPLY|BORROW|REPAY|WITHDRAW|LIQUIDITY|null,
ordinal: FIRST…FIFTH|LAST|null }`. It never supplies a node id.

* **Pronoun** (`step` and `ordinal` null: "it", "this", "isso"): the visible pending proposal; otherwise the most
  recent proposal Flofi showed if it was applied unchanged; otherwise the workflow's only editable step. Anything else →
  clarification listing the steps.
* **Named / ordinal** ("the swap", "o segundo passo", "the last step"): canonical steps in IR order, filtered by kind,
  then by ordinal; the pending proposal's new step is a candidate for named references. Exactly one candidate, or a
  clarification whose buttons name concrete steps. A button press resolves deterministically.
* **Edit**: the target's step is turned into a V1 action, the model's changes replace only their fields, the planners
  re-ground the changed fields against the open request, the exact grammar validates the result, and
  `editCommandFor` turns it into the existing edit command. A pending proposal is revised into a new proposal instead.
  Supported changes: amount, slippage, recipient/beneficiary and routing; bridge destination (a destination that does
  not pair with the current source makes Flofi ask which route, and a mainnet route must be named explicitly); liquidity
  maxima and range; lending composition supply/borrow amounts and swap slippage. Changing a Base swap's tokens or
  network, or a swap amount inside the composition, is explained, not guessed.
* **Remove**: `REMOVE` only when `canDeleteCanvasNode` allows it; otherwise the reason (first step, last step,
  composition member).
* **Insert** ("add a supply before the borrow"): the anchor is resolved, but Flofi's composition rules allow no
  insertion today (Aave actions are isolated; the only lending composition is Supply → Borrow → Swap). The Copilot says
  so and names the supported alternative. No new composition is invented.
* **Preview**: every proposal is run through `editorReducer` first. An edit the editor would reject or a no-op edit is
  explained instead of shown as an unappliable proposal.

## 7. Stale context

The engine snapshots the workflow object, pending proposal, wallet account and wallet chain when a message is sent.
If any of them changed when the answer arrives, the answer is discarded and the user is asked to resend (V1 message for
workflow changes). A Flofi question with step buttons carries the same snapshot; a reply after any change is refused.
A referent whose node no longer exists, or changed, cannot be resolved. The editor's `BASE_REVISION_CONFLICT` remains.

## 8. Read-only questions

`QUESTION { topic, target }` with topics `WORKFLOW_OVERVIEW`, `STEP_COUNT`, `STEP_DETAIL`, `PROTOCOLS`, `NETWORKS`,
`APPROVALS`, `EXECUTION_FLOW`, `EXECUTION_BLOCKERS`, `MANIFEST`, `SIMULATION`, `FAILURE`, `PROPOSAL`,
`REVIEW_FINDINGS`, `CAPABILITIES`, `MARKET_DATA`, `OTHER`. Flofi writes the answer from `CopilotFacts`:

| Source | Used for |
| --- | --- |
| Canonical IR via `workflow-steps.ts` | overview, steps, protocols, networks, failure policy, authorization class |
| Pending proposal and its diff | what the proposal changes |
| Lint review findings | warnings and blocks |
| `useWorkflowCapability()` | why execution is blocked; whether a current simulation, Manifest and authorization exist |
| Mocked artifact chain status | the generic path's mocked artifacts (labelled MOCKED) |
| Flofi's own flow semantics in the repository | which approvals a step needs (e.g. Router: exact approval, never unlimited), what happens on failure (Router: Across refund on the source chain after the fill deadline; lending: debt remains if the swap fails) |

Prices, APY, balances, gas, ETAs, health factors and chain state are not in Flofi's browser state, so `MARKET_DATA`
answers say so. Detailed per-flow simulation figures are shown in the Simulate tab; the Copilot reports whether a
current simulation exists. An answer creates no proposal and changes nothing.

## 9. CopilotIntentV2

`{ version: '2', language: 'EN'|'PT', kind, … }` with kinds `ACTION { action, reuse }`, `COMPOSITION { actions }`,
`EDIT { target, changes }`, `REPEAT { target, changes }`, `REMOVE { target }`, `INSERT { position, anchor, action }`,
`QUESTION { topic, target }`, `CLARIFICATION_REQUIRED { missing, question, options }`, `UNSUPPORTED { reason }`.
Actions are the V1 shapes. `changes` has a closed set of nullable fields (amount, slippage, networks, assets,
recipient, routing, deposits, range); at least one must be set. Strict exact keys, plain objects, closed enums, V1
patterns and lengths, at most 3 actions and 2 deposits. No calldata, chain id, nonce, signature, key, execution field or
node id exists in the schema. `language` only selects the reply language.

The server keeps the V1 protocol: a request without `version` is a V1 request with the V1 schema and replay file. The
browser now sends V2.

## 10. Portuguese, English and mixed input

The model interprets the language; Flofi validates the semantics. Network and asset detection is name-based and works
in both languages. Flofi's replies (questions, notes, answers, refusals) use the language the model reports for the
latest turn, with English as the fallback; English copy equals V1. Canonical exact-grammar sentences stay English.

## 11. Live hardening

Explicit `OPENAI_COPILOT_MODEL` (no default, no fallback). Optional bounded `OPENAI_COPILOT_TIMEOUT_MS`,
`OPENAI_COPILOT_MAX_OUTPUT_TOKENS` and `OPENAI_COPILOT_REASONING_EFFORT`. Closed codes for timeout, 401/403, 429 (with a
bounded `Retry-After`), other 4xx, 5xx, failed / incomplete responses, refusals, tool items, malformed JSON, schema
mismatch and oversized output. Telemetry is metadata only (protocol, mode, model, outcome code, intent kind, topic,
duration, message counts, input/output/reasoning tokens when reported); never prompts, keys, cookies, addresses or
transcripts. `FLOFI_COPILOT_TELEMETRY=off` disables it.

An owner-triggered live smoke test checks schema acceptance and interpretation on a few prompts. It never runs in CI,
contains no secret and touches no chain.

## 12. Tests

* Unit: step descriptors, edit commands, V2 parser and schema, grounding with carried fields, V1 regression (all
  existing tests unchanged), conversation engine, answers, secret guard, server V2 paths, telemetry privacy.
* Eval: ≥ 150 deterministic multi-turn cases (direct interpretation, clarification, multi-turn, references, edits,
  read-only Q&A, PT/EN/mixed, adversarial, races) driven through the real engine and editor with scripted model
  answers, plus global invariants checked on every turn (allowed command types only, no mutation without Apply, no
  ungrounded values, no invented numbers in answers, no authority claims) and a static check that the Copilot modules
  import nothing that can sign, submit or execute.
* Browser (replay, loopback only): clarification → proposal → revise → Apply; edit after Apply; read-only questions;
  ambiguity; safety refusals; removal; existing V1 journeys.
* Regression: `pnpm check`, governance-lite and its self-tests, main browser group, supply, lending, journey, router.

## 13. Out of scope

Monitoring, alerts, triggers, scheduling, background agents, autonomous execution or signing, portfolio management,
recommendations, browsing, news and trading signals. New protocols and new compositions.

## 14. Collision risk with the parallel UX branch

The UX branch (externally owned, not inspected) is likely to restyle `copilot-panel.tsx` and `globals.css`. This build
changes one statement in `copilot-panel.tsx` and nothing in `globals.css`. Everything else is in Copilot-only modules or
new files. A rebase conflict, if any, is limited to the `catch` block of `send`.
