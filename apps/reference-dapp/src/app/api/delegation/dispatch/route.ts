// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: `/api/delegation/dispatch` — optional bearer-only drain of delegated-execution work where this deployment hosts the
 * executor (never a hosted deployment). See `src/delegation/http.ts`.
 */
import { handleDelegationDispatch } from '../../../../delegation/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const POST = (request: Request) => handleDelegationDispatch(request);
