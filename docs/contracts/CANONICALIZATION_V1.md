# Canonical artifact hash profile v1

All structured inputs first pass raw UTF-8 JSON ingress and closed v1 schemas. A
plain object supplied directly to a pure hash helper cannot prove that its
original serialized bytes lacked duplicate keys. Production byte ingress is
`parseArtifactBytes` or `hashArtifactBytes`; the former rejects duplicate
decoded keys before object construction and Ajv validation.

The canonical payload is RFC 8785 JSON of the explicit
`HASH_FIELDS` projection in `packages/workflow-contracts/src/canonical.ts`.
Each structured artifact includes `schemaVersion: "1.0.0"`. Unknown fields,
signature fields, self-hashes, and runtime-only data fail closed schema
validation. Graph sets sort by their documented identifiers; artifact-set
members sort by raw 32-byte hash; sequences, including journal entries, retain
order. Numeric money is a native-unit decimal string. Unicode strings must be
well formed and are never normalized. UTF-8 has no BOM or terminator.

For each domain, the preimage bytes are exactly:

```text
ASCII("DWE-HASH") || 0x00 || 0x01 ||
uint16_be(length(ASCII(domain))) || ASCII(domain) ||
uint64_be(length(dataBytes)) || dataBytes
```

The domain is outside the canonical JSON payload. `0x01` is the profile
version byte; both lengths are unsigned big-endian integers. Ambiguous string
concatenation and platform newlines are prohibited. SHA-256 returns `0x` plus
64 lowercase hexadecimal digits. The domain names are:

| Kind | Exact ASCII domain |
|---|---|
| semantic-workflow | defi-workflow-engine/semantic-workflow |
| quote-state-artifact | defi-workflow-engine/quote-state-artifact |
| artifact-set | defi-workflow-engine/artifact-set |
| simulation-bundle | defi-workflow-engine/simulation-bundle |
| authorization-policy | defi-workflow-engine/authorization-policy |
| strategy-manifest | defi-workflow-engine/strategy-manifest |
| execution-plan | defi-workflow-engine/execution-plan |
| execution-journal-entry | defi-workflow-engine/execution-journal-entry |
| evidence-bundle | defi-workflow-engine/evidence-bundle |
| raw-response | defi-workflow-engine/raw-response |
| payload | defi-workflow-engine/payload |
| intent | defi-workflow-engine/intent |

Raw-response, payload, and intent domains hash their exact byte arrays as
`dataBytes`; they are not parsed or canonicalized. Journal entries hash their
own projected record with schema version, journal/workflow identity, plan and
manifest hashes, entry sequence, and predecessor hash. There is no invented
whole-journal hash; `journalHeadHash` is its final linked entry hash.

The frozen [language-neutral vectors](../../tests/compatibility/v1/hash-vectors.json)
give every payload, complete preimage, and digest in hexadecimal. An independent
Python standard-library test recomputes all twelve; TypeScript, Rust, and SDKs
must reproduce those bytes without JavaScript-specific serialization.

## Included fields and ordering

All top-level fields below are included. Every nested field permitted by its
closed schema is included recursively. Unlisted fields are rejected.

| Structured artifact | Included top-level fields |
|---|---|
| artifact-set | `schemaVersion`, `artifactSetId`, `semanticWorkflowHash`, `artifacts` |
| authorization-policy | `schemaVersion`, `policyId`, `semanticWorkflowHash`, `artifactSetHash`, `simulationHash`, `requiredAuthorizationClass`, `allowlists`, `budgetReservation`, `spendLimits`, `maximumSlippageBps`, `gasBudgets`, `feeBudgets`, `oracleRules`, `accountRiskRules`, `checkpointRules`, `providers`, `nonce`, `deadline`, `revocationEpoch`, `recovery`, `enforcement` |
| evidence-bundle | `schemaVersion`, `evidenceBundleId`, `version`, `supersedes`, `semanticWorkflowHash`, `artifactSetHash`, `simulationHash`, `policyHash`, `manifestHash`, `executionPlanHash`, `journalHeadHash`, `observedAt`, `environment`, `outcome`, `receipts`, `differences`, `reconciliation`, `evidence` |
| execution-plan | `schemaVersion`, `executionPlanId`, `semanticWorkflowHash`, `manifestHash`, `segments`, `checkpointIds`, `enforcement` |
| quote-state-artifact | `schemaVersion`, `artifactId`, `semanticWorkflowHash`, `nodeId`, `sourceId`, `adapter`, `chainId`, `chainPosition`, `retrievedAt`, `freshness`, `rawResponseHash`, `normalizedValues`, `providerReference`, `proposedContracts`, `proposedSpenders`, `proposedRecipients`, `fees`, `gas`, `outputBounds`, `uncertainty`, `registryValidation` |
| semantic-workflow | `schemaVersion`, `workflowId`, `revision`, `nodes`, `resourceEdges` |
| simulation-bundle | `schemaVersion`, `simulationId`, `semanticWorkflowRevision`, `semanticWorkflowHash`, `artifactSetHash`, `adapters`, `contracts`, `outputs`, `propagatedOutputs`, `failurePaths`, `uncertainty`, `unsupportedAssumptions`, `freshness` |
| strategy-manifest | `schemaVersion`, `manifestId`, `semanticWorkflowRevision`, `semanticWorkflowHash`, `artifactSetHash`, `simulationHash`, `policyHash`, `authorizationMode`, `owner`, `executor`, `expiresAt`, `nonce`, `revocationEpoch`, `spendLimits`, `maximumSlippageBps`, `gasBudgets`, `feeBudgets`, `providers`, `recovery`, `enforcement` |

Workflow nodes sort by nodeId; inputs and locked parameters by name; expected
outputs by outputId; editable bounds by parameterName. Node dependencies,
required capabilities and protocol constraints sort by ASCII identifier. Adapter
constraints sort by UTF-8 bytes of their JCS value. Resource edges sort by JCS
UTF-8 bytes of the tuple [fromNodeId, outputId, toNodeId, inputName]. Artifact-set
members sort by digest bytes and duplicate hashes are rejected. Policy allowlist
arrays sort by JCS UTF-8 bytes. Authorized provider IDs sort by ASCII identifier.
Execution-plan segment and step dependency arrays sort by identifier. Every
other array retains order, including execution segments, steps, user constraints,
output scenarios, receipts and evidence records.

Each journal-entry projection includes schemaVersion, journalId, workflowId,
executionPlanHash, manifestHash and the complete entry. The complete entry binds
its own schemaVersion, entryId, sequence, previousEntryHash, recordedAt,
eventType, level, entityId, workflowId, segmentId, stepId, executionAttemptId,
fromState and toState. No mutable hash field is silently omitted.
