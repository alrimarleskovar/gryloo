// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-MCP-002: RFC 9728 Protected Resource Metadata for `/api/mcp` (see `src/mcp/oauth/server.ts`). */
import { oauthHandler } from '../../../../../mcp/oauth/routes';

export const dynamic = 'force-dynamic';
const handler = oauthHandler('protected-resource');
export const GET = handler;
export const OPTIONS = handler;
