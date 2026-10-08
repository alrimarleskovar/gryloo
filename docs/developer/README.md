# FloFi for Developers

> **Developers build the experience. FloFi handles the DeFi workflow lifecycle.**

The FloFi Developer API lets a third-party **server** application use FloFi's deterministic DeFi engine: discover what FloFi can do,
store an immutable strategy, validate and simulate it, and hand it to an end user for approval. FloFi then runs the whole
lifecycle with the user's own wallet — fresh simulation, Strategy Manifest Review, explicit signature, execution, recovery,
reconciliation and evidence — and tells your app what happened.

| Document | What it covers |
| --- | --- |
| [QUICKSTART.md](QUICKSTART.md) | The ten-step integration with the TypeScript SDK |
| [API.md](API.md) | Endpoints, conventions, scopes, errors, limits, idempotency |
| [WEBHOOKS.md](WEBHOOKS.md) | Events, signatures, verification, retries, rotation |
| [openapi.json](openapi.json) | OpenAPI 3.1, generated from the server's own schemas |
| [`packages/developer-sdk`](../../packages/developer-sdk/README.md) | The thin TypeScript client (Apache-2.0, zero dependencies) |
| [deploy/DEVELOPER.md](../deploy/DEVELOPER.md) | For the deployment's operator: enabling, keys, scheduler, runbook |

## What your API key can and cannot do

| Your server can | Only the end user can, in FloFi, with their own wallet |
| --- | --- |
| discover capabilities per action and network | prove which wallet they are |
| store immutable strategies (FloFi's StrategySpec) | load a proposal into their FloFi workflow |
| validate and simulate them (read-only previews) | run the authoritative fresh simulation |
| create an approval and get its FloFi link | review the Strategy Manifest and approve it |
| follow the approval's state | sign each transaction |
| read runs and evidence **the user chose to share** | decide whether your app may see the outcome (off by default) |

The key is a **server-side credential with zero financial authority**. It is not a wallet, never a wallet session, and nothing it
can call signs, submits or approves anything. FloFi refuses requests from browsers (`BROWSER_ORIGIN_FORBIDDEN`): never ship a key
to a web page or a mobile app.

## One engine, one execution truth

The Developer API is a surface over the same FloFi platform as the FloFi app and the MCP gateway: the same composition, canonical
IR and workflow hash, Strategy Review, capability facts, simulation preview and approval handoff. A strategy created through the
API has exactly the workflow hash FloFi's own chat or MCP would compute. Evidence is copied from FloFi's Evidence Bundles (MOCKED,
TESTNET_EXECUTED, …) and never upgraded.

## Environments

This release issues **sandbox** credentials only (`flofi_sk_test_…`): test-funds strategies, every mainnet off. A strategy that
touches a mainnet is refused at creation (`MAINNET_DISABLED`). Production credentials (`flofi_sk_live_…`) are reserved and refused
(`LIVE_MODE_DISABLED`). On a deployment whose flows run against MOCKED chains, capabilities and validations say so
(`mockedHarness: true`) and evidence is `MOCKED`.
