# BUILD-COPILOT-002 — Report: conversational Flofi Copilot

Date: 2026-10-05. Branch `claude/build-copilot-002`, from `origin/main` `d58b535` (BUILD-COPILOT-001 merged as PR #59).
Plan: [BUILD-COPILOT-002-PLAN.md](BUILD-COPILOT-002-PLAN.md).

> **The AI is still an untrusted natural-language interpreter with no financial authority.** It now holds a bounded
> conversation, points at existing steps and classifies read-only questions. Flofi resolves every reference, owns every
> value's provenance, writes every factual answer and still needs an explicit **Apply**.

## 1. Status

**IMPLEMENTATION COMPLETE — LIVE MODEL NOT YET EXERCISED.** Evidence level: MOCKED. Unit tests, a 198-case deterministic
eval and replay browser suites cover the conversation, reference resolution, edits, read-only answers and adversarial
inputs. No live OpenAI request was made (no key in this environment, and tests must not call OpenAI). No blockchain
transaction was signed or sent. No wallet, execution, recovery, reconciliation or evidence code changed.

## 2. What the user can do now

| User | Flofi |
| --- | --- |
| "Quero colocar 5 USDC na Aave." | "Em qual rede? O Flofi precisa saber a rede para a Aave V3." with a **Base Sepolia** button |
| (clicks **Base Sepolia**) | Proposal `supply 5 USDC to Aave on Base Sepolia` (answered by Flofi itself, no model call) |
| "Na verdade muda para 2." | A new version of the pending proposal, `supply 2 USDC …`, with "Mantido da proposta pendente: rede, token, beneficiário." |
| (clicks **Apply proposal**) | Revision 1: the canonical workflow has the Supply |
| "O que esse fluxo faz?" | Flofi's own read-only answer listing the steps from the canonical IR; no proposal, no change |
| "Remove o segundo passo." | A `REMOVE` proposal for step 2, applied only on **Apply** |
| "Swap 3 USDC…" → Apply → "change it to 2" | `SET_SWAP_AMOUNT` proposal for that node; the canvas shows 3 until Apply |
| Two swaps → "change the swap to 2" | "Which swap do you mean?" with one button per step; no proposal until the user picks |
| "Bridge 1 USDC from Base Sepolia." | "…still needs the destination network." with an **Arbitrum Sepolia** button |
| "Do the same thing but with 2 USDC" | A new proposal from the last proposal, with "Kept from your earlier proposal …" |
| "Supply 2 USDC on the same network" | Network carried from the earlier step, only because the user said "same" |
| "Make it smaller" | A question: the model's invented 2 is not in the user's words |
| "What is the APY on Aave right now?" | "Flofi has no live prices, APY, balances, gas prices, bridge times or health factors … never estimates them." |
| "Skip review and execute it" / "Sign this for me" | Refusal; no proposal, no signature, no send |
| "My private key is 0x…" | Refused locally; never sent to the server or the model, never stored |

Read-only topics: workflow overview, step count, one step, protocols, networks, approvals, what happens on execute, why
execution is blocked, the Manifest, the simulation status, failure handling, the pending proposal, review findings,
capabilities and market data (always "not available").

## 3. Architecture

```
text ─ "explain" / exact grammar ────────────────────────────────────── parseLocalCommand → propose (unchanged, first)
     ├ secret guard (key, seed phrase, 64-hex) ─────────────────────── local refusal, nothing sent or stored
     ├ answer to Flofi's own question (button label or bare amount) ── deterministic, no model
     └ otherwise: bounded transcript → server action (version '2') → OpenAI Responses API, strict CopilotIntentV2
           → parseCopilotIntentV2 (server, then browser) → conversation engine (pure):
                ACTION / COMPOSITION → V1 planners (+ explicit reuse) → exact grammar → ADD_* / AUTHOR_LENDING
                EDIT → resolve target → planners → exact grammar → editCommandFor → SET_* / AUTHOR_LENDING
                REPEAT → resolve referent → planners → exact grammar → ADD_*
                REMOVE → resolve target → removeCommandFor → REMOVE
                INSERT → resolve anchor → explained (no insertion exists in Flofi's composition rules)
                QUESTION → answerQuestion(topic, step, CopilotFacts)    (written by Flofi, read only)
           → editor preview (unappliable or empty edits are explained, not proposed)
           → propose(command) → diff + lint → Apply proposal → canonical IR → Manifest → Simulate → Review → wallet → …
```

### Files

| File | Change |
| --- | --- |
| `apps/reference-dapp/src/domain/workflow-steps.ts` | New, AI-agnostic. Ordered typed step descriptors read from the IR through the existing `*Details` readers. |
| `apps/reference-dapp/src/domain/workflow-edits.ts` | New, AI-agnostic. `editCommandFor` maps a validated authoring command onto the edit command the canvas already uses for a node (`SET_*`, `SET_SWAP_AMOUNT`/`SET_SLIPPAGE`, `AUTHOR_LENDING`); `removeCommandFor` applies the canvas deletion rules. |
| `apps/reference-dapp/src/domain/copilot-intent-v2.ts` | New. `CopilotIntentV2` types, limits, strict parser, structured-output schema, transcript prefixes. |
| `apps/reference-dapp/src/domain/copilot-messages.ts` | New. English (byte-identical to V1) and Portuguese copy. |
| `apps/reference-dapp/src/domain/copilot-authoring.ts` | Planners take a grounding context. `copilotIntentToCommand` (V1) keeps its signature and behaviour. |
| `apps/reference-dapp/src/domain/copilot-intent.ts` | Additive: exports the V1 validators for reuse (`COPILOT_V1_PARTS`). |
| `apps/reference-dapp/src/domain/copilot-conversation.ts` | New. The pure conversation engine. |
| `apps/reference-dapp/src/domain/copilot-answers.ts` | New. Read-only answers from `CopilotFacts`. |
| `apps/reference-dapp/src/server/copilot-service.ts` | Additive: protocol V2, tuning, telemetry, Retry-After, segment-keyed replay. The V1 response reader was split into a shared extractor with identical behaviour. |
| `apps/reference-dapp/src/app/copilot-action.ts` | V1/V2 dispatch, V2 replay file, telemetry sink, tuning. |
| `apps/reference-dapp/src/components/copilot-ai.tsx` | The hook drives the engine and builds `CopilotFacts`; same exports. Copy mentions edits and questions. |
| `apps/reference-dapp/src/components/copilot-panel.tsx` | **Shared file, +2/−1** (see §11). |
| `apps/reference-dapp/e2e/copilot/replay-v2.json`, `e2e/copilot-conversation.spec.ts` | New replay answers and 6 browser journeys. |
| `apps/reference-dapp/e2e/copilot.spec.ts` | Two assertions now expect Portuguese replies to Portuguese input; header comment. |
| `apps/reference-dapp/src/domain/*.test.ts`, `copilot-eval.corpus.ts`, `copilot-session.test-harness.ts`, `copilot-test-fixtures.ts`, `src/server/copilot-service-v2.test.ts` | Tests, eval corpus and test-only harnesses. |
| `apps/reference-dapp/src/server/copilot-live.live.test.ts` | Owner-triggered live smoke test, excluded from `pnpm test` and CI. |
| `package.json` | `test` excludes `**/*.live.test.ts` (like `*.fork.test.ts`/`*.pg.test.ts`); new `test:copilot-live`. No dependency change. |
| `.github/workflows/contracts.yml` | The existing Copilot replay line also runs `copilot-conversation.spec.ts`. No gate removed. |
| `docs/builds/BUILD-COPILOT-002-*.md`, `docs/STATUS.md`, `docs/deploy/CLOUD.md` | Plan, report, status, configuration. |

Not changed: `commands.ts`, `editor.ts`, `proposal.ts`, `workflow-store.tsx`, `capability-store.tsx`, the canonical IR and
contracts, action registry, wallet/session/ownership code, execution, recovery, reconciliation, evidence, `globals.css`,
visual baselines, the app manifest and `pnpm-lock.yaml`.

## 4. Security invariants

* **No authority.** The engine is pure: no React, network, wallet, storage or server access (a test reads the sources and
  fails on any such import or call). The hook only calls `propose` and, in off mode, `dismissProposal` (a test checks
  this too). Nothing can apply, dispatch, simulate, review, execute, sign or connect.
* **Closed command set.** `COPILOT_V2_COMMANDS`: the V1 authoring commands, `SET_SUPPLY/BORROW/REPAY/WITHDRAW`,
  `SET_SOLANA_SWAP`, `SET_ROUTER_BRIDGE`, `SET_UNISWAP_LIQUIDITY`, `SET_SOLANA_LIQUIDITY`, `SET_SWAP_AMOUNT`, `SET_SLIPPAGE`
  and `REMOVE`. Every command is `CHAT`, at the current revision, passes `commandIsValid`, and must pass the editor
  preview before it is shown. New authoring still comes only from `parseLocalCommand` on a Flofi-rendered sentence; edits
  go through the same planners and exact grammar first, then through `editCommandFor`.
* **No model-chosen targets.** A target is `{ step kind, ordinal }`; node ids in the model output are rejected. Pronouns
  resolve to the visible pending proposal, then to the last proposal only if it was applied unchanged, then to the only
  editable step; anything else becomes a question with concrete step buttons.
* **Provenance.** Explicit values must be grounded in the open request (V1 rules). Carried values come only from a
  resolved canonical step, the visible pending proposal or an earlier proposal Flofi recorded, and a reuse or repeat
  needs the user's own wording ("same", "again", "mesmo", "de novo"). The model is never a source. Carried values are
  listed in the reply.
* **Real funds.** A mainnet is accepted only when named in the open request or carried from a step the user authored,
  and never when the request contains test-network wording. V2 no longer defaults networks or completes bridge pairs.
* **Grounded answers.** Every read-only answer is written by Flofi from `CopilotFacts` (IR, pending proposal and diff,
  lint findings, capability blockers, the active flow's own simulation/review record, the mocked chain status). The eval
  checks every number in every answer against that state.
* **Stale context.** Workflow, pending proposal, wallet account and wallet chain are snapshotted by identity when a
  message is sent and when Flofi asks a question with buttons; any change discards the answer.
* **Privacy.** The model receives no workflow, no IR identifiers and no address the user did not type (Flofi's own
  transcript entries redact addresses). Secrets are refused locally. Telemetry is metadata only. The key stays in the
  server `Authorization` header.
* **Model prose.** Only clarification questions/options and unsupported reasons are model text, sanitized as in V1
  (links, hex strings, addresses and execution claims are replaced by deterministic copy).

## 5. Conversation model and bounds

The engine keeps a transcript (≤ 16 messages, ≤ 8 user turns, ≤ 12,000 characters, starts and ends with the user), the
open request segment (≤ 6 user messages; explicit values must come from it), Flofi's open question with deterministic
buttons, at most 3 clarifications per request, and up to 4 referents (proposals the user saw, including exact-grammar
proposals). Flofi's transcript entries are short summaries (`Flofi proposed: …`, `Flofi asked: …`, `Flofi declined: …`,
`Flofi answered a read-only question (…)`); read-only answers are not copied into the transcript. The server validates
the same bounds independently and never treats the transcript as state.

## 6. Edit resolution

| Request | Result |
| --- | --- |
| Amount / slippage of a Base or Base Sepolia swap | `SET_SWAP_AMOUNT` or `SET_SLIPPAGE`; both at once, or other tokens or network, are explained |
| Solana swap, Router bridge, Aave step, liquidity | `SET_SOLANA_SWAP`, `SET_ROUTER_BRIDGE`, `SET_SUPPLY/BORROW/REPAY/WITHDRAW`, `SET_UNISWAP_LIQUIDITY`, `SET_SOLANA_LIQUIDITY` |
| Lending composition supply/borrow amount, swap slippage | `AUTHOR_LENDING` (the same command the lending inspectors use); the swap amount is always the borrowed USDC |
| Bridge destination that does not pair with the source | "Which route do you mean?" (mainnet only when named, with no test wording) |
| Pending proposal | A new proposal replaces it (`ADD_*` revision, or a new `SET_*` for a pending edit) |
| Remove | `REMOVE` under `canDeleteCanvasNode`; the first step, the only step, composition members, dependencies and locked steps are explained |
| Insert ("add a supply before the borrow") | Explained: Flofi's composition rules allow no insertion; the supported composition is named |
| Template or legacy step | "Edit it on the canvas." |
| No-op | "already has these values" |

## 7. CopilotIntentV2

`{ version: '2', language: 'EN'|'PT', kind, … }`: `ACTION { action, reuse }`, `COMPOSITION`, `EDIT { target, changes }`,
`REPEAT`, `REMOVE`, `INSERT`, `QUESTION { topic, target }`, `CLARIFICATION_REQUIRED`, `UNSUPPORTED`. Exact keys, plain
objects, closed enums, V1 patterns and lengths, ≤ 3 actions, ≤ 2 deposits, an edit needs ≥ 1 change, a range is all or
nothing. The schema has no calldata, chain id, nonce, signature, key, execution field or node id (tested). The V1 protocol
still works unchanged for requests without a version, with its own replay file; all V1 tests are unchanged and pass.

## 8. Portuguese, English and mixed input

The model reports the latest message's language; Flofi writes its replies in English (identical to V1) or Portuguese.
Network, token and amount grounding is language-neutral (`1,5`, `1.000`, `0,5%` are read exactly). The exact grammar and
canonical sentences stay English, as before. Option buttons are matched exactly in either language. Global UI copy is
unchanged.

## 9. Live hardening

Explicit model, no default and no fallback. Bounded optional `OPENAI_COPILOT_TIMEOUT_MS`, `OPENAI_COPILOT_MAX_OUTPUT_TOKENS`
and `OPENAI_COPILOT_REASONING_EFFORT`; an invalid value makes the Copilot unavailable. Closed codes for timeout, 401/403,
429 (with a bounded `Retry-After` shown to the user), other 4xx, 5xx, `failed` and `incomplete` responses, content-filter
stops (refusal), refusals, tool items, malformed JSON, schema mismatch and oversized bodies or output. One metadata-only
telemetry record per request: protocol, mode, model, outcome code, intent kind, question topic, duration, message counts,
input/output/reasoning tokens and the model the API reports (`FLOFI_COPILOT_TELEMETRY=off|log`; live logs by default).
The owner-only smoke test (`pnpm test:copilot-live`) probes schema acceptance, interpretation kinds, latency and tokens.

## 10. Tests and validation

All runs on the final code, locally, with the pinned toolchain (Node 24.21.0, pnpm 11.22.0, Anvil 1.8.3, headless shell 1243).

| Check | Result |
| --- | --- |
| `pnpm check` (typecheck, lint, build, schemas:check, unit) | **Passed: 1,705 tests passed, 2 skipped** (176 files passed, 2 skipped; the two existing skips). Main had 1,462 + 2; +243 new tests. |
| Copilot unit tests (`copilot-*`, `workflow-steps`, `workflow-edits`, V1 and V2 service), excluding the live test | 294 passed (all 51 V1 tests unchanged) |
| Eval corpus (`copilot-eval.test.ts`) | 202 passed: 198 cases + coverage, invariant totals and 2 static authority checks |
| `pnpm test:copilot-live` without configuration | Fails closed as designed ("Set FLOFI_COPILOT_LIVE_SMOKE=1 …"); not run against OpenAI |
| `python3 scripts/governance_lite.py` (on a clean `git archive` export of the branch) | Passed (914 text files) |
| `python3 -m unittest discover -s scripts -p 'test_governance_lite.py'` | 17 passed |
| `git diff --check origin/main` | Clean |
| Browser: `copilot.spec.ts` + `copilot-conversation.spec.ts` (`FLOFI_COPILOT=replay`, MOCKED supply harness) | **13/13 passed** (7 existing journeys + 6 new) |
| Browser: main CI group (18 specs incl. `visual-shell` zero-pixel baselines), Copilot off | **53/53 passed** |
| Browser: supply group (`supply`, `supply-recovery`, `borrow`, `repay`, `withdraw`) | **44/44 passed** |
| Browser: `lending-composition.spec.ts` | **17/17 passed** |
| Browser: `journey.spec.ts` | **3/3 passed** |
| Browser: `router.spec.ts` | **4/4 passed** |

New browser journeys (`copilot-conversation.spec.ts`): the Portuguese DoD conversation (network question → button → proposal →
"Na verdade muda para 2." → revised proposal → Apply → "O que esse fluxo faz?" → "Remove o segundo passo." → Apply, zero
wallet sends); an edit of an applied swap that changes the canvas only on Apply; two swaps → "change the swap to 2" → step
buttons, no guess; read-only questions (overview, protocol, simulation, blockers, APY) with no proposal or change; authority
requests, an injected beneficiary and a private key, none of which produce a proposal, signature or send; a bridge that asks
where to go, then "do the same thing but with 2 USDC".

Eval corpus (`copilot-eval.test.ts`): 198 cases, 258 turns (211 scripted model calls, 27 resolved locally by Flofi, the rest exact grammar): 83 proposals,
50 read-only answers, 41 clarifications, 44 refusals, 20 failures. Categories: direct 24, clarification 18, multi-turn 15,
references/edits 37, read-only 36, language 22, adversarial 28, unsupported 10, races 8; languages EN 162, PT 28, mixed 8.
Absolute invariants, checked on every turn: **0** autonomous signatures, **0** autonomous executions, **0** AI-authored
calldata, **0** proposal/Apply bypasses, **0** ungrounded values, **0** invented runtime facts, **0** disallowed commands,
**0** privacy leaks (workflow data or untyped addresses in a model request).

Finding kept as designed: the exact grammar recognizes many natural phrasings case-insensitively ("Borrow 2 USDC from Aave
on Base Sepolia"), so they never reach the model; the corpus asserts this.

Problems found by these checks and fixed before delivery:
* a pool choice made with Flofi's own button could loop when the request named both pools; the latest message now settles it;
* removal sentences showed node ids; they now name the step;
* Flofi's transcript entries could carry a carried beneficiary address to the model; they are redacted;
* Portuguese contractions in edit and provenance replies; the local secret refusal now answers in Portuguese for
  Portuguese wording;
* a test input shaped like a seed phrase tripped governance-lite's detector; it is now ordinary words;
* running governance-lite in the worktree rewrites the tracked `scripts/__pycache__/*.pyc`; they were restored and are not
  part of this change.

## 11. Shared-file touchpoints and collision risk with the UX branch

* `copilot-panel.tsx` (+2/−1): in `send`'s `catch`, `dismissProposal()` moved from before the AI branch to the non-AI
  branch, with a one-line comment. The Copilot keeps the pending proposal visible while it interprets, which "make it 2"
  and questions about the proposal need. In off mode, unrecognized text still dismisses it (the hook does it when the
  server reports the Copilot off, and the panel does it in the non-AI branch).
* `globals.css`: not changed. No layout, style, navigation or visual change; visual baselines were not updated.
* Everything else is in Copilot-only modules or new files. A rebase conflict with the UX branch, if any, is limited to
  that `catch` block.

## 12. Limitations

* **No live model run.** The V2 schema follows the Responses API strict structured-output rules and is tested for them,
  but acceptance by a specific model, interpretation quality and latency are unverified until the owner runs the smoke
  test with a key.
* Interpretation quality depends on the model. When it is wrong the outcome is a question, a refusal or a reviewable
  proposal, never an applied change; a misread request can still produce a proposal the user must reject (eval case X28).
* Simulation answers report whether a current simulation or accepted Review exists for the active flow; the figures
  themselves stay in the Simulate tab. Prices, APY, balances, gas, ETAs and health factors are not available.
* Approvals and failure answers describe Flofi's implemented flows; Borrow and Withdraw answers stay generic ("Review
  lists every transaction") rather than asserting an approval count.
* Inserting steps is not supported by Flofi's composition rules; the Copilot explains this instead of inventing a
  composition. Removing the only step is refused (a workflow keeps one step).
* Amounts still need digits. Deterministic slot filling covers Flofi's own buttons and bare amounts for new actions;
  other answers go to the model.
* The rate limit is per server process, not a global quota. The secret guard is a heuristic (64-hex strings, key/seed
  wording, 12–24 lowercase words) and errs on refusing.
* Two `copilot.spec.ts` assertions changed from English to Portuguese because replies now follow the user's language.

## 13. Owner actions

1. Review and merge the PR (agents do not merge).
2. Choose a model with strict structured-output support, then run once locally:
   `FLOFI_COPILOT_LIVE_SMOKE=1 FLOFI_COPILOT=live OPENAI_API_KEY=… OPENAI_COPILOT_MODEL=… pnpm test:copilot-live`.
   For reasoning models set `OPENAI_COPILOT_TEMPERATURE=omit` and consider `OPENAI_COPILOT_REASONING_EFFORT=low`.
3. Then set the same variables on the frontend deployment (server-side only) and try the journeys in §2 before applying
   anything.
