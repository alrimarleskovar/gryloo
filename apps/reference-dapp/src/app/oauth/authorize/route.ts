// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-MCP-002: the authorization endpoint and the consent decision (see `src/mcp/oauth/server.ts`). */
import { oauthHandler } from '../../../mcp/oauth/routes';

export const dynamic = 'force-dynamic';
const handler = oauthHandler('authorize');
export const GET = handler;
export const POST = handler;
