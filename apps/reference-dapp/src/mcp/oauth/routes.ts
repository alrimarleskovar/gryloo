// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: Next.js route handlers for the OAuth endpoints (see `server.ts`). Logs go through the cloud runtime's
 * structured, redacting logger, loaded on first use like the MCP gateway's; no token, code or secret is ever logged.
 */
import { handleOAuthRequest, type OAuthLogger, type OAuthRoute } from './server.ts';

let logger: Promise<OAuthLogger> | null = null;
const log = () => logger ??= import('@defi-workflow-engine/cloud-runtime').then(runtime => runtime.createLogger({ service: 'flofi-mcp-oauth' }));
export const oauthHandler = (route: OAuthRoute) => async (request: Request): Promise<Response> => handleOAuthRequest(route, request, { logger: await log() });
