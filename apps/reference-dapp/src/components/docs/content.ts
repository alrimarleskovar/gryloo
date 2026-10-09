// SPDX-License-Identifier: AGPL-3.0-only
/** Editorial summaries of verified repository contracts. Each article retains its primary sources. */
export type Block =
  | { type: 'text'; text: string }
  | { type: 'callout'; title: string; text: string; tone?: 'warning' | undefined }
  | { type: 'code'; language: 'typescript' | 'bash' | 'json'; title: string; code: string }
  | { type: 'steps'; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] };
export type Article = { slug: string; title: string; group: string; description: string; status: string; sources: string[]; sections: { id: string; title: string; blocks: Block[] }[] };
const text = (text: string): Block => ({ type: 'text', text });
const note = (title: string, text: string, tone?: 'warning' | undefined): Block => ({ type: 'callout', title, text, tone });
const code = (language: 'typescript' | 'bash' | 'json', title: string, code: string): Block => ({ type: 'code', language, title, code });
const steps = (...items: string[]): Block => ({ type: 'steps', items });
const table = (headers: string[], rows: string[][]): Block => ({ type: 'table', headers, rows });

export const articles: Article[] = [
  {
    slug: 'getting-started', title: 'Getting Started', group: 'Start here', status: 'Available',
    description: 'From an idea to a workflow you can inspect. Meet the FloFi lifecycle and set up your first session.',
    sources: ['README.md', 'docs/STATUS.md', 'docs/deploy/ENVIRONMENT.md'],
    sections: [
      { id: 'the-lifecycle', title: 'Intent, made executable', blocks: [text('FloFi connects workflow authoring to simulation, explicit review, wallet authorization and verifiable outcomes. Chat and the visual builder describe the same workflow; neither can move funds by itself.'), steps('Build a supported workflow in [the app](/app).', 'Simulate the current workflow and inspect its assumptions.', 'Review the [Strategy Manifest](/docs/strategy-manifest).', 'Authorize with your own wallet, then follow execution and evidence.'), note('Start without a wallet', 'You can explore authoring before connecting a wallet. Provider-dependent simulation and financial paths require the deployment’s documented configuration.')] },
      { id: 'local-setup', title: 'Run FloFi locally', blocks: [text('Use the repository’s pinned Node 24.21.0 and pnpm 11.22.0. Keep existing GRYLOO_* environment settings: the product rename did not change runtime identifiers.'), code('bash', 'Terminal', 'git clone https://github.com/alrimarleskovar/gryloo.git\ncd gryloo\npnpm install --frozen-lockfile --ignore-scripts\npnpm build\npnpm --filter @defi-workflow-engine/reference-dapp dev'), text('Open http://127.0.0.1:3000 for the landing, /docs for these guides, or /app for the builder. Installation starts the local shell; it does not enable integrations or execution.')] },
      { id: 'choose-your-path', title: 'Choose your starting point', blocks: [text('Follow [Your First Workflow](/docs/your-first-workflow) for the product journey. Integrating from a server? Start with the [Developer API](/docs/developer-api) and [TypeScript SDK](/docs/typescript-sdk). For an agent client, read [MCP Integrations](/docs/mcp-integrations).'), note('Availability is specific', 'Support is resolved by action × network × environment. Implementation, deployment enablement, policy and demonstrated evidence are separate facts. Read [Supported Networks](/docs/supported-networks) before selecting a financial path.', 'warning')] },
    ],
  },
  {
    slug: 'your-first-workflow', title: 'Your First Workflow', group: 'Start here', status: 'Guided tutorial',
    description: 'Build, simulate and review a small workflow while keeping every financial decision in your hands.',
    sources: ['README.md', 'docs/STATUS.md', 'docs/contracts/INVALIDATION_V1.md'],
    sections: [
      { id: 'build', title: '1. Describe a supported action', blocks: [text('Open [Launch FloFi](/app). Choose a network and a supported action in the builder, or describe the intent in chat. Use the assets, amounts and environment shown by that deployment. Apply the proposal only after checking its details.'), note('A concrete starting point', 'Aave V3 Supply on Base Sepolia has recorded owner execution for its exact verified profile. This is testnet evidence, not a promise that every deployment, asset or amount is enabled. Obtain valueless test funds separately before any owner-signed exercise.')] },
      { id: 'simulate', title: '2. Simulate the current revision', blocks: [text('Run simulation and inspect quotes, balances, allowances, fees, output bounds and limitations where the selected adapter exposes them. Resolve blockers before proceeding. A simulated result is not an executed transaction.'), text('If you edit the amount, asset, network or another material value, simulate again. [Simulation](/docs/simulation) and the [invalidation rules](/docs/strategy-manifest#invalidation) explain why the previous artifacts cannot authorize the edited workflow.')] },
      { id: 'review', title: '3. Review before authorizing', blocks: [steps('Read the Strategy Manifest, including recipient, spend limits, providers and expiry.', 'Connect the intended wallet and prove ownership where required.', 'Approve the fresh review explicitly.', 'Inspect each wallet request before signing. You may decline.'), note('Your signature is a separate decision', 'Applying a chat proposal, connecting a wallet and proving ownership do not authorize a transaction.', 'warning')] },
      { id: 'verify', title: '4. Follow the outcome', blocks: [text('Watch execution status and reconciliation. A transaction hash alone is not sufficient proof of the intended result. Inspect the Evidence Bundle and its environment. An unknown submission must be investigated before any replacement; do not blindly retry.'), text('Continue with [Execution & Verification](/docs/execution-verification) to understand receipts, recovery and evidence boundaries.')] },
    ],
  },
  {
    slug: 'chat-visual-builder', title: 'Chat & Visual Builder', group: 'Build a workflow', status: 'Implemented · configuration varies',
    description: 'Two ways to author one canonical workflow, with proposals you can inspect before applying.',
    sources: ['docs/STATUS.md', 'docs/builds/BUILD-COPILOT-002-REPORT.md', 'docs/contracts/INVALIDATION_V1.md'],
    sections: [
      { id: 'one-workflow', title: 'One workflow, two interfaces', blocks: [text('Chat interprets intent into a proposal. The visual builder exposes supported nodes and their configuration. Both author the canonical Semantic Workflow IR. Moving a card on the canvas changes presentation, not financial semantics.'), text('Inspect and apply the proposed edit before it enters your workflow. The conversational Copilot can ask for missing facts, revise a proposal and describe visible workflow state; ambiguous references require clarification.')] },
      { id: 'conversation', title: 'Keep the proposal explicit', blocks: [steps('State the action, network, asset and amount.', 'Answer clarification questions rather than relying on inferred financial values.', 'Read the resulting proposal and select Apply proposal.', 'Simulate and review the resulting workflow revision.'), note('AI availability', 'The conversational interpreter is implemented with deterministic replay evidence. Live-model operation is separately configured and was not established by those tests. Chat does not expand the capability registry or gain financial authority.')] },
      { id: 'compositions', title: 'Composition has boundaries', blocks: [text('A list of steps can be composed and reviewed without being executable. The existing Base Sepolia supply → borrow → swap lending composition has a dedicated implementation. Other arbitrary multi-step sequences may be refused with `MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED`.'), text('Continue with [Simulation](/docs/simulation) and [Wallet Authorization](/docs/wallet-authorization) for the execution boundary.')] },
    ],
  },
  {
    slug: 'supported-networks', title: 'Supported Networks', group: 'Build a workflow', status: 'Action × network × environment',
    description: 'Understand the difference between recognized networks, enabled actions and demonstrated execution.',
    sources: ['README.md', 'docs/STATUS.md', 'docs/developer/API.md'],
    sections: [
      { id: 'capability-model', title: 'Discover capabilities, not assumptions', blocks: [text('FloFi resolves a capability for a specific action, network and environment. The developer capability response separates `supportedByCode`, `enabledByDeployment`, `enabledByPolicy` and `demonstratedEvidence`. A recognized chain does not imply every action is available.'), text('An operator-enabled integration can query [GET /capabilities](/docs/developer-api#endpoints) for the current deployment. The static overview below describes repository implementation and evidence, not a live availability promise.')] },
      { id: 'network-overview', title: 'Network overview', blocks: [table(['Network / environment', 'Repository boundary'], [
        ['Base Sepolia', 'Selected Aave V3, Uniswap v3 and cross-chain profiles; exact Aave operations have recorded TESTNET_EXECUTED evidence.'],
        ['Ethereum Sepolia', 'Selected Aave V3 and Uniswap v3 implementations; read-only and controlled rehearsal evidence does not establish owner public execution.'],
        ['Robinhood Testnet', 'Selected testnet profiles, including a recorded owner-signed native transfer.'],
        ['Solana Devnet', 'Orca swaps and concentrated liquidity; exact owner operations have DEVNET_EXECUTED evidence with valueless tokens.'],
        ['Arbitrum Sepolia', 'Destination in selected bridge / cross-chain profiles; availability depends on the path and deployment.'],
        ['Local fork / loopback', 'Finite Safe/Roles, Uniswap, composition and CoW demonstrations; evidence stays FORK_REPRODUCED or MOCKED.'],
        ['Mainnet profiles', 'Some adapters exist, including Jupiter. Implementation does not establish enabled production authority or mainnet acceptance.'],
        ['Tempo', 'Upcoming. No runtime integration is enabled by this branch.'],
      ])] },
      { id: 'evidence', title: 'Read the evidence boundary', blocks: [note('One proof does not certify another path', 'Evidence applies to the documented asset, protocol, chain, environment and operation. Read [Execution & Verification](/docs/execution-verification#evidence-levels) before interpreting a reconciled result.', 'warning'), text('Developer sandbox keys refuse strategies touching mainnet. Deployment and policy checks may further narrow test-funds availability.')] },
    ],
  },
  {
    slug: 'simulation', title: 'Simulation', group: 'Build a workflow', status: 'Implemented · adapter dependent',
    description: 'Inspect a workflow before committing, and understand what a preview can and cannot establish.',
    sources: ['docs/developer/API.md', 'docs/developer/QUICKSTART.md', 'docs/contracts/INVALIDATION_V1.md'],
    sections: [
      { id: 'artifacts', title: 'Simulation is bound to a revision', blocks: [text('Simulation consumes the selected path’s quotes and observed state. Its hash-linked artifacts feed policy, the Strategy Manifest and the execution plan. Quotes and state can expire; material workflow edits invalidate downstream references.'), note('A forecast, not a guarantee', 'Simulation cannot guarantee execution prices, inclusion or outcomes. The owner’s fresh simulation and review remain required before authorization.')] },
      { id: 'server-preview', title: 'A read-only server preview', blocks: [code('typescript', 'Server-side SDK', 'const preview = await flofi.strategies.simulate(strategy.id, {\n  simulationSubject: userAddress,\n});\n// preview: true, persisted: false, authorizable: false\n// authority: "NONE"'), text('The subject is a public address whose state the preview reads. It is not authenticated wallet ownership and grants no authority. The Developer API preview does not expose calldata or signatures. Multi-step API previews are refused with `SIMULATE_ONE_STEP_AT_A_TIME`.')] },
      { id: 'refresh', title: 'Refresh before review', blocks: [steps('Check provenance, freshness and any limitations.', 'Resolve blocking findings.', 'Re-simulate after material edits or quote expiration.', 'Review the new [Strategy Manifest](/docs/strategy-manifest).'), text('MOCKED previews retain MOCKED provenance. A successful preview cannot upgrade evidence to testnet or mainnet execution.')] },
    ],
  },
  {
    slug: 'strategy-manifest', title: 'Strategy Manifest', group: 'Review & execute', status: 'Canonical contract',
    description: 'The readable commitment between your intent, the simulated workflow and its bounded authorization.',
    sources: ['docs/contracts/CANONICALIZATION_V1.md', 'docs/contracts/INVALIDATION_V1.md', 'docs/AUTHORITY_MATRIX.md'],
    sections: [
      { id: 'review-commitment', title: 'Review the exact commitment', blocks: [text('The Manifest binds semantic revision and workflow hash to the artifact set, simulation and policy hashes. Its canonical fields include owner, executor, authorization mode, expiry, nonce, spend limits, maximum slippage, gas and fee budgets, providers, recovery and enforcement.'), text('Read recipient and spender information in the selected path’s review. A hash links artifacts; it does not itself enforce every condition onchain. Enforcement must be interpreted against the actual supported adapter and authorization mode.')] },
      { id: 'invalidation', title: 'What requires a fresh review?', blocks: [table(['Change', 'Invalidated references'], [['Semantic edit', 'Quotes/state, artifact set, simulation, policy, Manifest, execution plan and authorization'], ['Quote refresh or expiration', 'Artifact set through authorization'], ['Simulation change', 'Policy through authorization'], ['Policy edit', 'Manifest, execution plan and authorization'], ['Manifest edit', 'Execution plan and authorization'], ['Execution plan edit', 'Authorization'], ['Journal/evidence append or presentation edit', 'None under the v1 dependency matrix']]), note('Invalidation is not revocation', 'These dependency declarations do not revoke an onchain permission. Consumers compare revisions and hashes and obtain fresh human authorization when required.', 'warning')] },
      { id: 'next-decision', title: 'Then the wallet decides', blocks: [text('Explicit Manifest approval and the applicable wallet signature are separate steps. A changed identity, stale artifact or unsupported capability fails closed. Read [Wallet Authorization](/docs/wallet-authorization) for those boundaries.')] },
    ],
  },
  {
    slug: 'wallet-authorization', title: 'Wallet Authorization', group: 'Review & execute', status: 'Owner controlled',
    description: 'Wallet connection, ownership proof, Manifest approval and transaction signing are separate decisions.',
    sources: ['docs/AUTHORITY_MATRIX.md', 'docs/SECURITY_MODEL.md', 'docs/developer/QUICKSTART.md', 'docs/deploy/MCP.md'],
    sections: [
      { id: 'separate-decisions', title: 'Four separate boundaries', blocks: [steps('Connection selects a wallet provider and account.', 'EIP-4361 or Sign-In With Solana proves ownership where the flow requires it; this is not a transaction authorization.', 'Fresh simulation and explicit Strategy Manifest approval bind the reviewed workflow.', 'Your wallet signs the applicable transaction or supported permission request.'), text('FloFi does not hold the user’s private key or seed phrase. Never enter them into a chat, API request or approval link.')] },
      { id: 'integration-handoffs', title: 'An integration can ask, not authorize', blocks: [text('Developer keys and MCP OAuth authenticate integrations or accounts. They do not prove wallet ownership. Approval links carry a view/claim handoff secret in the URL fragment; opening or claiming a link does not approve the Manifest or sign a transaction.'), note('Status sharing is optional', 'Execution status and evidence are shared with a Developer API project only when the owner enables sharing. It is off by default.')] },
      { id: 'permissions', title: 'Understand the actual enforcement', blocks: [text('Direct signing and finite Safe/Zodiac Roles permissions have different enforcement models. The bounded Safe/Roles demonstrations are controlled local-fork profiles; they do not establish general production automation. A review commitment is not a substitute for contract-enforced limits.'), text('Account changes, stale hashes and unsupported paths invalidate unused authority. For unknown submissions, follow [Execution & Verification](/docs/execution-verification#recovery).')] },
    ],
  },
  {
    slug: 'execution-verification', title: 'Execution & Verification', group: 'Review & execute', status: 'Evidence retains provenance',
    description: 'Follow durable execution state, handle uncertainty and inspect evidence for the exact outcome.',
    sources: ['README.md', 'docs/EVIDENCE_LEVELS.md', 'docs/STATUS.md', 'docs/developer/API.md'],
    sections: [
      { id: 'reconciliation', title: 'From submission to reconciliation', blocks: [text('Supported adapters track attempts and receipts, recover durable status and reconcile the observed effects against the intended workflow. A successful receipt and a transaction hash are inputs to verification; the adapter’s required checks still need to agree.'), text('The canonical Evidence Bundle binds workflow, artifact, simulation, policy, Manifest, plan and journal references with observations, differences and reconciliation. API consumers can read only executions the owner shares.')] },
      { id: 'recovery', title: 'Uncertainty is a real state', blocks: [note('Do not blindly retry an unknown send', 'An ambiguous submission requires receipt, nonce, permission-consumption and balance investigation before replacement. Recovery does not grant new execution authority.', 'warning'), text('Use the existing flow’s recovery controls and durable status. A restored saved workflow needs fresh simulation and review. Reconciliation can remain inconclusive or divergent when required observations disagree.')] },
      { id: 'evidence-levels', title: 'Evidence levels', blocks: [table(['Level', 'What it establishes'], [['MOCKED', 'Synthetic or deterministic controlled execution; no public financial result'], ['FORK_REPRODUCED', 'The documented controlled local-fork operation'], ['PUBLIC_READ_ONLY', 'Public-chain observations; not an executed transaction'], ['TESTNET_EXECUTED / DEVNET_EXECUTED', 'The exact owner-signed operation on its test-funds network'], ['MAINNET_EXECUTED', 'Requires separate actual mainnet execution evidence; not inferred from code or previews']]), text('Some frozen bundle schemas encode Solana Devnet as TESTNET_EXECUTED while its documented evidence class is DEVNET_EXECUTED. Preserve that distinction. A reconciled MOCKED result remains MOCKED.')] },
    ],
  },
  {
    slug: 'developer-api', title: 'Developer API', group: 'Integrate FloFi', status: 'Sandbox · operator enabled',
    description: 'Compose and preview strategies from your server, then hand the financial decision to the user in FloFi.',
    sources: ['docs/developer/API.md', 'docs/developer/QUICKSTART.md', 'docs/deploy/DEVELOPER.md', 'docs/developer/openapi.json'],
    sections: [
      { id: 'availability', title: 'Availability and authentication', blocks: [note('Server-side sandbox integration', 'The API is implemented with controlled local/MOCKED integration evidence. An operator must enable the deployment and issue a sandbox key. Live keys and mainnet strategies are refused. API keys have zero financial authority.', 'warning'), text('Base path: `https://<deployment>/api/developer/v1`. Send `Authorization: Bearer <sandbox key>` from a server secret store. Requests carrying Origin or Sec-Fetch-Site are refused; there are no browser API credentials or CORS shortcuts.'), code('bash', 'Capability discovery', 'curl "https://<deployment>/api/developer/v1/capabilities" \\\n  -H "Authorization: Bearer $FLOFI_API_KEY"')] },
      { id: 'endpoints', title: 'Implemented endpoints', blocks: [table(['Method', 'Path', 'Purpose'], [['GET', '/capabilities', 'Discover action × network availability'], ['POST', '/strategies', 'Create an immutable StrategySpec'], ['POST', '/strategies/{id}/validate', 'Re-check the engine and deployment'], ['POST', '/strategies/{id}/simulate', 'Read-only preview for a public subject'], ['POST', '/approvals', 'Create an owner approval handoff'], ['GET', '/approvals/{id}', 'Current approval and shared execution status'], ['GET', '/executions/{id}', 'Owner-shared execution status'], ['GET', '/executions/{id}/evidence', 'Canonical evidence of a shared run'], ['POST', '/webhook-endpoints', 'Register signed notifications'], ['DELETE', '/webhook-endpoints/{id}', 'Retire a webhook endpoint']]), text('Paths in this table are relative to the base path. Download the [verified OpenAPI contract](/docs/api-reference.json). No execution, signing, submission or Manifest-approval endpoint exists.')] },
      { id: 'strategy-to-handoff', title: 'Create, validate, hand off', blocks: [code('typescript', 'Server-side TypeScript', 'const strategy = await flofi.strategies.create({\n  strategy: {\n    action: "bridge",\n    sourceNetwork: "base-sepolia",\n    destinationNetwork: "arbitrum-sepolia",\n    asset: "USDC", amount: "5",\n  },\n});\nconst check = await flofi.strategies.validate(strategy.id);\nif (!check.availability.approvable) {\n  throw new Error(check.availability.reason ?? "NOT_APPROVABLE");\n}\nconst approval = await flofi.approvals.create({ strategy });\n// Give approval.approvalUrl to the user.'), text('This is a documented example, not a claim that bridge approval is enabled on every deployment. The user proves wallet ownership, re-simulates, reviews and signs in FloFi. Read [Wallet Authorization](/docs/wallet-authorization).')] },
      { id: 'errors-and-retries', title: 'Errors, idempotency and limits', blocks: [text('Amounts are decimal strings. Strategies are immutable; create a new one for a changed intent. Creating POSTs use an Idempotency-Key scoped to project, environment and operation for 24 hours. Same key with a changed body yields IDEMPOTENCY_CONFLICT.'), code('json', 'Error envelope', '{\n  "error": {\n    "code": "STRATEGY_CHANGED",\n    "reason": "WORKFLOW_HASH_MISMATCH",\n    "message": "…",\n    "requestId": "req_…"\n  }\n}'), text('The documented free plan permits 300 requests/minute, 30 simulations/hour, 60 approval creations/hour, 100 open approvals and five active webhook endpoints. Respect Retry-After. Listing strategies, GET /me, live keys and general arbitrary multi-step execution are not part of v1.')] },
    ],
  },
  {
    slug: 'typescript-sdk', title: 'TypeScript SDK', group: 'Integrate FloFi', status: 'Private workspace package',
    description: 'A small, dependency-free server client for the implemented Developer API and signed webhooks.',
    sources: ['packages/developer-sdk/README.md', 'packages/developer-sdk/src/client.ts', 'docs/developer/WEBHOOKS.md'],
    sections: [
      { id: 'setup', title: 'Use the workspace SDK', blocks: [note('Package availability', 'The SDK is private in this repository. npm publication is not authorized. Use the existing workspace package; there is no public npm installation command to follow.'), text('The API guide supports Node 20+ or a runtime with fetch and Web Crypto. Developing this repository uses its separately pinned Node 24.21.0 and pnpm 11.22.0.'), code('typescript', 'Server initialization', 'import { FloFi, FloFiError, verifyWebhook }\n  from "@defi-workflow-engine/developer-sdk";\n\nconst flofi = new FloFi({\n  apiKey: process.env.FLOFI_API_KEY!,\n  baseUrl: "https://<your FloFi deployment>",\n});')] },
      { id: 'discover', title: 'Discover the deployment first', blocks: [code('typescript', 'Capabilities', 'const { data } = await flofi.capabilities.list({\n  network: "base-sepolia", action: "bridge",\n});\nconst available = data.filter(row => row.operations.approve.available);'), text('Use an available row’s exampleStrategy and retain the returned canonical strategy and hash. Continue with the [Developer API tutorial](/docs/developer-api#strategy-to-handoff). FloFi makes capability decisions; the SDK contains no alternate workflow engine.')] },
      { id: 'webhooks', title: 'Verify signed notifications', blocks: [code('typescript', 'Raw-body verification', 'const event = await verifyWebhook({\n  payload: rawBody,\n  headers: request.headers,\n  secret: process.env.FLOFI_WEBHOOK_SECRET!,\n});\n// Deduplicate event.id before handling.\n// Fetch the resource again for its current state.'), text('Verify the raw request body before parsing or re-serialization. Delivery ordering is not guaranteed. execution.* notifications are emitted only while the user shares status. Notifications do not authorize a workflow or change its financial state.')] },
      { id: 'retries', title: 'Handle failures deliberately', blocks: [text('FloFiError carries status, code, reason, requestId, issues and retryAfter. The client retries safe GETs and keyed POSTs after network errors, 429, 502, 503 and 504, honoring Retry-After. Creating calls reuse their idempotency key across those retries.'), text('An execution uncertainty is not an API retry opportunity. Follow the financial flow’s [recovery boundary](/docs/execution-verification#recovery).')] },
    ],
  },
  {
    slug: 'mcp-integrations', title: 'MCP Integrations', group: 'Integrate FloFi', status: 'Operator enabled · local evidence',
    description: 'Give an agent structured discovery and composition tools while keeping authorization in FloFi.',
    sources: ['docs/deploy/MCP.md', 'docs/STATUS.md', 'apps/reference-dapp/src/app/api/mcp/route.ts'],
    sections: [
      { id: 'connect', title: 'Connect a configured deployment', blocks: [text('The gateway is POST /api/mcp on the FloFi web deployment, using Streamable HTTP. The operator enables FLOFI_MCP and, for consumer clients, FloFi OAuth with durable PostgreSQL state and an exact FLOFI_PUBLIC_ORIGIN. These are server-side settings.'), note('Implemented is not live acceptance', 'The integration has MOCKED/loopback evidence. That does not establish live ChatGPT or Claude acceptance, nor public transaction execution. Operator configuration and client acceptance remain separate.')] },
      { id: 'tools', title: 'Tools follow explicit scopes', blocks: [table(['Scope', 'Tools'], [['flofi.strategy', 'get_supported_networks, get_supported_assets, get_capabilities, compose_strategy, validate_strategy, review_strategy, simulate_strategy'], ['flofi.approval', 'request_user_approval, get_approval_status; approval-session tools are app-only'], ['flofi.runs', 'get_execution_status, get_evidence for wallets linked on FloFi']]), text('Inputs use closed JSON Schemas. The same StrategySpec and workflow hash are used by the app, API and MCP. General arbitrary step sequences remain non-executable until a sequential runner exists.')] },
      { id: 'handoff', title: 'Keep the approval in FloFi', blocks: [steps('Discover current capabilities and compose a supported strategy.', 'Validate and optionally obtain a read-only simulation preview.', 'Request an approval handoff for the exact strategy hash.', 'The owner opens FloFi, proves their wallet, runs fresh simulation, reviews and signs.'), note('The model has no financial authority', 'OAuth, an MCP account and an approval link cannot sign, submit or approve a Manifest. Mainnet handoffs are disabled by default and require separate operator policy.', 'warning'), text('See the primary operator guide linked below for deployment variables and the full client connection procedure.')] },
    ],
  },
  {
    slug: 'security', title: 'Security', group: 'Understand FloFi', status: 'Fail-closed boundaries',
    description: 'Understand who holds authority, how data is scoped and what evidence does not claim.',
    sources: ['docs/SECURITY_MODEL.md', 'docs/AUTHORITY_MATRIX.md', 'docs/EVIDENCE_LEVELS.md'],
    sections: [
      { id: 'authority', title: 'Financial authority stays with the owner', blocks: [text('AI proposals and integration credentials cannot authorize funds. FloFi does not custody private keys or seed phrases. Financial execution requires the supported path’s fresh artifacts, explicit review and applicable owner wallet authorization.'), text('Wallet proof, integration authentication and a transaction signature serve different purposes. Read [Wallet Authorization](/docs/wallet-authorization) before connecting an integration.')] },
      { id: 'data-and-identity', title: 'Scope reads and handoffs', blocks: [text('Developer keys authenticate server projects and are stored as digests. Live keys and mainnet strategies are refused in the sandbox release. Browser-origin Developer API requests are rejected. Approval handoff secrets travel in URL fragments, and execution status sharing is off by default.'), text('Absent, unshared and another project’s execution resources return the same not-found response. Account changes, expired artifacts, mismatched hashes and unavailable capability paths fail closed.')] },
      { id: 'evidence-boundaries', title: 'Evidence is not a blanket certification', blocks: [note('Read the scope', 'Source availability, local tests and a reconciled MOCKED result are not an independent security audit or production readiness claim. Simulations cannot guarantee outcomes.', 'warning'), text('Controlled forks, public read-only checks and exact owner testnet runs establish different facts. Preserve the original evidence class and the documented network, asset and operation. Engineering history and certification records remain in their primary repository documents.')] },
    ],
  },
  {
    slug: 'architecture', title: 'Architecture', group: 'Understand FloFi', status: 'Shared platform',
    description: 'One semantic workflow engine connects product interfaces, integrations and bounded execution adapters.',
    sources: ['README.md', 'docs/contracts/CANONICALIZATION_V1.md', 'docs/deploy/CLOUD.md', 'docs/AUTHORITY_MATRIX.md'],
    sections: [
      { id: 'shared-engine', title: 'Interfaces converge on one engine', blocks: [text('Chat, the visual builder, the Developer API, SDK, MCP and conversational channels feed the shared FloFi platform. Canonical Semantic Workflow IR is checked against the capability registry and validated before producing artifacts.'), code('bash', 'Lifecycle', 'Chat / Builder / API / MCP\n            ↓\nCanonical Semantic Workflow IR\n            ↓\nCapabilities → Validation → Simulation\n            ↓\nStrategy Manifest → Owner wallet authorization\n            ↓\nExecution → Reconciliation → Evidence Bundle')] },
      { id: 'packages', title: 'Repository responsibilities', blocks: [table(['Location', 'Responsibility'], [['apps/reference-dapp', 'Next.js product, public site, docs and integration routes'], ['packages/workflow-contracts', 'Canonical schemas, hashes and lifecycle contracts'], ['packages/action-registry', 'Action and capability definitions'], ['packages/reference-linter / reference-compiler', 'Validation and bounded execution planning'], ['packages/reference-executor / reference-reconciler', 'Execution tracking and outcome verification'], ['packages/cloud-runtime', 'Durable platform / runtime infrastructure'], ['packages/developer-sdk', 'Thin server-side API and webhook client']])] },
      { id: 'durability', title: 'Durable state, specific runtimes', blocks: [text('The embedded cloud runtime uses PostgreSQL for platform state. Specific financial flow runtimes remain separately configured. Deployment availability is not inferred from the presence of a route or adapter.'), text('Recovery preserves attempt history and evidence provenance. A semantic edit invalidates downstream commitments; a presentation edit does not. Read the [Strategy Manifest](/docs/strategy-manifest#invalidation) and [Security](/docs/security) guides for the trust boundaries.')] },
    ],
  },
];

export const searchIndex = articles.flatMap(article => [
  { title: article.title, section: '', href: `/docs/${article.slug}`, text: article.description, group: article.group },
  ...article.sections.map(section => ({ title: article.title, section: section.title, href: `/docs/${article.slug}#${section.id}`, group: article.group,
    text: section.blocks.map(block => block.type === 'text' ? block.text : block.type === 'code' ? block.code : block.type === 'steps' ? block.items.join(' ') : block.type === 'table' ? block.rows.flat().join(' ') : `${block.title} ${block.text}`).join(' ') })),
]);
