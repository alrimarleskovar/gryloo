// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-MCP-002: RFC 7591 dynamic client registration (narrow; off unless FLOFI_MCP_OAUTH_DCR=enabled) (see `src/mcp/oauth/server.ts`). */
import { oauthHandler } from '../../../mcp/oauth/routes';

export const dynamic = 'force-dynamic';
const handler = oauthHandler('register');
export const POST = handler;
export const OPTIONS = handler;
