// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-MCP-002: RFC 7009 token revocation (see `src/mcp/oauth/server.ts`). */
import { oauthHandler } from '../../../mcp/oauth/routes';

export const dynamic = 'force-dynamic';
const handler = oauthHandler('revoke');
export const POST = handler;
export const OPTIONS = handler;
