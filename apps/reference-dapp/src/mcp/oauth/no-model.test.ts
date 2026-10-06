// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002 regression: no FloFi-owned model is ever called. The consumer's own assistant (Claude, ChatGPT) interprets
 * language; FloFi's MCP gateway, OAuth server, approval handoff, in-chat panel and /approve page only compute. No source of those
 * surfaces imports a model SDK, reaches a model API, reads a model API key or reaches the FloFi Copilot; and the whole OAuth +
 * MCP journey works with every model key unset.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MODEL = /from ['"](openai|@anthropic-ai\/[a-z-]+|@ai-sdk\/[a-z-]+|@google\/generative-ai)['"]|api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|copilot-service|copilot-action|OPENAI_API_KEY|ANTHROPIC_API_KEY/i;
const ROOTS = ['src/mcp', 'src/engine', 'src/app/api/mcp', 'src/app/oauth', 'src/app/.well-known', 'src/app/approve', 'src/app/approve-action.ts', 'src/app/connections',
  'src/components/approval-handoff.tsx'];
function files(path: string): string[] {
  let stat; try { stat = statSync(path); } catch { return []; }
  if (stat.isFile()) return /\.(ts|tsx|mjs|html)$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path] : [];
  return readdirSync(path).flatMap(name => files(join(path, name)));
}

describe('BUILD-MCP-002: no FloFi LLM cost', () => {
  it('no MCP, OAuth, handoff, panel or approval source references a model client, API or key', () => {
    const scanned = ROOTS.flatMap(root => files(join(__dirname, '..', '..', '..', root)));
    expect(scanned.length).toBeGreaterThan(20);
    for (const file of scanned) expect(readFileSync(file, 'utf8'), file).not.toMatch(MODEL);
  });
});
