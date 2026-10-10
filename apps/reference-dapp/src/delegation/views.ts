// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: what the browser receives about delegated execution — plain data, safe for the client bundle. No view carries key
 * material, a session-key reference, an owner signature beyond what the owner just produced, or another owner's data. Amounts are decimal
 * strings in token units (converted with the registry's decimals); native units stay inside the server.
 */
export type PasskeyView = { readonly passkeyId: string; readonly label: string; readonly credentialId: string; readonly createdAt: string; readonly lastUsedAt: string | null;
  readonly revoked: boolean };
export type GrantScopeView = { readonly kind: 'EVM'; readonly router: string; readonly pairs: readonly { readonly input: string; readonly output: string; readonly perCallCap: string }[];
  readonly maxCalls: number } | { readonly kind: 'SOLANA'; readonly tokens: readonly { readonly symbol: string; readonly amount: string; readonly tokenAccount: string }[] };
export type GrantView = { readonly grantId: string; readonly credentialId: string; readonly walletNamespace: 'eip155' | 'solana'; readonly walletAddress: string;
  readonly chain: string; readonly network: string; readonly mechanism: string; readonly state: string; readonly scope: GrantScopeView; readonly sessionAddress: string;
  readonly commitment: string | null; readonly passkeyId: string; readonly verifiedAt: string | null; readonly validFrom: string; readonly expiresAt: string; readonly callsUsed: number;
  /** Only while PENDING_SIGNATURE: what the wallet must sign to enroll. */
  readonly enrollment: Readonly<Record<string, unknown>> | null;
  /** Only while REVOCATION_REQUESTED: what the wallet must sign/send to revoke on-chain. */
  readonly revocation: Readonly<Record<string, unknown>> | null;
  readonly onChain: readonly string[]; readonly application: readonly string[] };
export type CredentialView = { readonly credentialId: string; readonly walletNamespace: 'eip155' | 'solana'; readonly walletAddress: string; readonly label: string;
  readonly grants: readonly GrantView[] };
export type AmountView = { readonly asset: string; readonly symbol: string; readonly chain: string; readonly amount: string };
export type BudgetView = { readonly asset: string; readonly symbol: string; readonly chain: string; readonly maxPerExecution: string;
  readonly periods: readonly { readonly period: 'DAY' | 'WEEK' | 'MONTH'; readonly limit: string; readonly spent: string; readonly reserved: string; readonly remaining: string }[] };
export type ManifestStepView = { readonly stepIndex: number; readonly label: string; readonly chain: string; readonly network: string; readonly credentialId: string;
  readonly grantId: string; readonly walletAddress: string; readonly mechanism: string };
export type ManifestView = { readonly authorizationId: string; readonly revision: number; readonly manifestHash: string; readonly workflowHash: string; readonly chains: readonly string[];
  readonly networks: readonly string[]; readonly actions: readonly string[]; readonly steps: readonly ManifestStepView[];
  readonly assets: readonly { readonly asset: string; readonly symbol: string; readonly chain: string; readonly role: 'INPUT' | 'OUTPUT'; readonly maxPerExecution: string | null;
    readonly budgets: readonly { readonly period: string; readonly amount: string }[] }[];
  readonly recipients: readonly string[]; readonly maxExecutionsPerPeriod: { readonly count: number; readonly period: string } | null; readonly cooldownSeconds: number;
  readonly maxSlippageBps: number; readonly validFrom: string; readonly expiresAt: string; readonly enforcement: Readonly<Record<string, readonly string[]>>;
  readonly setupSignatures: number };
export type ExecutionStepView = { readonly step: number; readonly state: string; readonly chain: string; readonly network: string; readonly credentialId: string; readonly grantId: string;
  readonly mechanism: string; readonly grantCommitment: string; readonly submissions: readonly string[]; readonly spent: readonly AmountView[]; readonly received: readonly AmountView[];
  readonly code: string | null; readonly provenance: string | null };
export type ExecutionView = { readonly executionId: string; readonly authorizationId: string; readonly revision: number; readonly ruleId: string; readonly occurrenceId: string;
  readonly state: string; readonly code: string | null; readonly attention: boolean; readonly currentStep: number; readonly stepCount: number; readonly createdAt: string;
  readonly updatedAt: string; readonly settledAt: string | null; readonly evidenceLevel: string | null; readonly steps: readonly ExecutionStepView[] };
export type AuthorizationView = { readonly authorizationId: string; readonly ruleId: string; readonly ruleName: string; readonly state: string; readonly latestRevision: number;
  readonly activeRevision: number | null; readonly manifest: ManifestView; readonly widening: readonly string[]; readonly signedAt: string | null; readonly revokedAt: string | null;
  readonly budget: readonly BudgetView[]; readonly executions: number; readonly lastExecution: ExecutionView | null };
export type CapabilityRowView = { readonly action: string; readonly network: string; readonly protocol: string; readonly delegated: boolean; readonly mechanism: string | null;
  readonly reason: string | null };
export type DelegationOverviewView = {
  readonly availability: { readonly enabled: boolean; readonly mode: 'PRODUCTION' | 'MOCKED_HARNESS' | null; readonly executor: string | null; readonly enrollment: string | null };
  readonly passkeys: readonly PasskeyView[]; readonly credentials: readonly CredentialView[]; readonly authorizations: readonly AuthorizationView[];
  readonly executions: readonly ExecutionView[]; readonly capabilities: readonly CapabilityRowView[];
};
export type PreviewStepView = { readonly index: number; readonly network: string; readonly chain: string; readonly label: string; readonly inputs: readonly AmountView[];
  readonly capability: { readonly delegated: boolean; readonly mechanism: string | null; readonly code: string | null };
  readonly binding: { readonly credentialId: string; readonly grantId: string; readonly walletAddress: string } | null; readonly failure: string | null };
export type RequiredEnrollmentView = { readonly stepIndex: number; readonly namespace: 'eip155' | 'solana'; readonly network: string; readonly mechanism: string | null;
  readonly reason: string };
export type PreviewView = { readonly ok: boolean; readonly workflowHash: string | null; readonly steps: readonly PreviewStepView[];
  readonly requiredEnrollments: readonly RequiredEnrollmentView[]; readonly manifest: ManifestView | null; readonly problem: string | null };
export type ReviewView = { readonly authorizationId: string; readonly revision: number; readonly challenge: string; readonly passkey: { readonly passkeyId: string;
  readonly credentialId: string; readonly rpId: string }; readonly manifest: ManifestView; readonly widening: readonly string[]; readonly envelopeDigest: string };
export type CreatedView = { readonly ruleId: string; readonly authorizationId: string; readonly manifest: ManifestView };
export type PasskeyOptionsView = { readonly challenge: string; readonly rpId: string; readonly rpName: string; readonly userId: string; readonly userName: string;
  readonly excludeCredentials: readonly string[]; readonly timeoutMs: number };
