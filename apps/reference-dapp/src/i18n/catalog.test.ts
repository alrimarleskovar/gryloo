// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { portuguese } from './pt';
import { translate } from './locale';
import { preservedValues } from './preserved-values';

/** Checks actual translation calls in product components, excluding tests and the deliberate literal inventory. */
function productMessages() {
  const root = fileURLToPath(new URL('../components/', import.meta.url)), keys = new Set<string>();
  for (const file of readdirSync(root, { recursive: true }).filter(file => typeof file === 'string' && file.endsWith('.tsx') && !file.endsWith('.test.tsx')) as string[]) {
    const src = ts.createSourceFile(file, readFileSync(join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function argument(node: ts.Node) {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) keys.add(node.text.trim());
      else if (ts.isTemplateExpression(node)) keys.add((node.head.text + node.templateSpans.map((span, i) => `{${i}}${span.literal.text}`).join('')).trim());
      else if (ts.isConditionalExpression(node)) { argument(node.whenTrue); argument(node.whenFalse); }
    }
    function scan(node: ts.Node) {
      if (ts.isCallExpression(node) && /^(tr|t)$/.test(node.expression.getText(src)) && node.arguments[0]) argument(node.arguments[0]);
      ts.forEachChild(node, scan);
    }
    scan(src);
  }
  return [...keys].filter(Boolean);
}
describe('central product locale catalog', () => {
  it('covers every explicit product translation call or a reviewed literal value', () => {
    expect(productMessages().filter(key => !Object.hasOwn(portuguese, key) && !preservedValues.has(key))).toEqual([]);
  });
  it('preserves placeholders in every translated message', () => {
    for (const [key, value] of Object.entries(portuguese)) {
      expect(value.trim(), key).not.toBe('');
      expect([...new Set(value.match(/\{\d+\}/g) ?? [])].sort(), key).toEqual([...new Set(key.match(/\{\d+\}/g) ?? [])].sort());
    }
  });
  it('preserves network, asset, protocol and technical values across languages', () => {
    for (const value of ['USDC', 'WETH', 'SOL', 'Base', 'Ethereum Mainnet', 'Arbitrum One', 'Solana mainnet-beta', 'Uniswap V3', 'Jupiter', '0x' + 'a'.repeat(40), '0x' + 'b'.repeat(64), 'eip155:8453', 'multicall(exactInputSingle)']) expect(translate('PT', value)).toBe(value);
    expect(translate('PT', 'Source amount ({0})', 'USDC')).toBe('Montante de origem (USDC)');
  });
});
