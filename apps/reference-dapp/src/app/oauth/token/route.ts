// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-MCP-002: the token endpoint (authorization_code with PKCE, refresh_token with rotation) (see `src/mcp/oauth/server.ts`). */
import { oauthHandler } from '../../../mcp/oauth/routes';

export const dynamic = 'force-dynamic';
const handler = oauthHandler('token');
export const POST = handler;
export const OPTIONS = handler;
