// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-MCP-002: RFC 8414 Authorization Server Metadata (see `src/mcp/oauth/server.ts`). */
import { oauthHandler } from '../../../mcp/oauth/routes';

export const dynamic = 'force-dynamic';
const handler = oauthHandler('authorization-server');
export const GET = handler;
export const OPTIONS = handler;
