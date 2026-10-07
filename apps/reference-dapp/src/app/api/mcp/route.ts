// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-001: `POST /api/mcp` — the FloFi Remote MCP Gateway (Streamable HTTP, stateless; see `src/mcp/gateway.ts`).
 * Disabled unless `FLOFI_MCP=enabled` with `FLOFI_MCP_CLIENTS`; every request needs a FloFi MCP bearer credential.
 */
import { handleMcpRequest, type GatewayLogger } from '../../../mcp/gateway';

export const dynamic = 'force-dynamic';
// A simulation preview may wait on paced public RPC reads and provider quotes, as the DApp's own Simulate does.
export const maxDuration = 300;

let logger: Promise<GatewayLogger> | null = null;
// Loaded on first use, like the embedded runtime: the structured, redacting logger of the cloud runtime.
const log = () => logger ??= import('@defi-workflow-engine/cloud-runtime').then(runtime => runtime.createLogger({ service: 'flofi-mcp' }));

async function serve(request: Request): Promise<Response> {
  return handleMcpRequest(request, { logger: await log() });
}
export const POST = serve;
// Stateless serving: GET and DELETE (2025 session operations) are authenticated, then answered by the SDK (405).
export const GET = serve;
export const DELETE = serve;
