// SPDX-License-Identifier: AGPL-3.0-only
import { parseJsonBytes } from '@defi-workflow-engine/workflow-contracts';
import { readBuildEstimate } from '../../../server/build-estimate';
export async function POST(request: Request) {
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 262_144) return Response.json({ ok: false, code: 'ESTIMATE_INVALID' }, { status: 413 });
  try { return Response.json(await readBuildEstimate(parseJsonBytes(new Uint8Array(bytes)))); }
  catch { return Response.json({ ok: false, code: 'ESTIMATE_INVALID' }, { status: 400 }); }
}
