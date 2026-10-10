// SPDX-License-Identifier: AGPL-3.0-only
'use server';
/**
 * BUILD-AUTOMATION-002: server actions of delegated execution (Passkeys, Credentials, Automations "Automatic within limits"). Each goes through
 * `server/delegation-operation.ts`, which re-verifies the owner's HttpOnly wallet session (and a fresh sign-in for passkey registration) and
 * runs the closed operation where this deployment's runtime runs. None of these actions signs or submits a transaction: wallet enrollment and
 * revocation signatures are produced by the owner's own wallet in the browser; the workflow authorization by the owner's own passkey.
 */
import type { WorkflowOwner } from '../domain/saved-workflow';
import type { CreatedView, DelegationOverviewView, ExecutionView, GrantView, PasskeyOptionsView, PasskeyView, PreviewView, ReviewView, AuthorizationView } from '../delegation/views';
import { delegationOperation } from '../server/delegation-operation';

type Result<T> = { ok: true; value: T } | { ok: false; code: string };
export async function delegationOverview(owner: WorkflowOwner): Promise<Result<DelegationOverviewView>> { return delegationOperation('overview', [], owner); }
export async function passkeyOptions(owner: WorkflowOwner): Promise<Result<PasskeyOptionsView>> { return delegationOperation('passkeyOptions', [], owner); }
export async function passkeyRegister(owner: WorkflowOwner, response: unknown): Promise<Result<PasskeyView>> { return delegationOperation('passkeyRegister', [response], owner); }
export async function passkeyRevoke(owner: WorkflowOwner, passkeyId: string): Promise<Result<PasskeyView>> { return delegationOperation('passkeyRevoke', [passkeyId], owner); }
export async function credentialPrepare(owner: WorkflowOwner, input: unknown): Promise<Result<GrantView>> { return delegationOperation('credentialPrepare', [input], owner); }
export async function credentialComplete(owner: WorkflowOwner, grantId: string, response: unknown): Promise<Result<GrantView>> {
  return delegationOperation('credentialComplete', [grantId, response], owner);
}
export async function credentialRevoke(owner: WorkflowOwner, grantId: string): Promise<Result<GrantView>> { return delegationOperation('credentialRevoke', [grantId], owner); }
export async function credentialRevocationComplete(owner: WorkflowOwner, grantId: string, response: unknown): Promise<Result<GrantView>> {
  return delegationOperation('credentialRevocationComplete', [grantId, response], owner);
}
export async function credentialReverify(owner: WorkflowOwner, grantId: string): Promise<Result<GrantView>> { return delegationOperation('credentialReverify', [grantId], owner); }
export async function delegatedAutomationPreview(owner: WorkflowOwner, input: unknown): Promise<Result<PreviewView>> { return delegationOperation('automationPreview', [input], owner); }
export async function delegatedAutomationCreate(owner: WorkflowOwner, input: unknown): Promise<Result<CreatedView>> { return delegationOperation('automationCreate', [input], owner); }
export async function authorizationReview(owner: WorkflowOwner, authorizationId: string): Promise<Result<ReviewView>> {
  return delegationOperation('authorizationReview', [authorizationId], owner);
}
export async function authorizationSign(owner: WorkflowOwner, authorizationId: string, revision: number, assertion: unknown): Promise<Result<AuthorizationView>> {
  return delegationOperation('authorizationSign', [authorizationId, revision, assertion], owner);
}
export async function authorizationRevoke(owner: WorkflowOwner, authorizationId: string): Promise<Result<AuthorizationView>> {
  return delegationOperation('authorizationRevoke', [authorizationId], owner);
}
export async function authorizationReauthorize(owner: WorkflowOwner, authorizationId: string): Promise<Result<ReviewView>> {
  return delegationOperation('authorizationReauthorize', [authorizationId], owner);
}
export async function executionResume(owner: WorkflowOwner, executionId: string): Promise<Result<ExecutionView>> { return delegationOperation('executionResume', [executionId], owner); }
