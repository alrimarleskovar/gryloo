import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { artifactSchemas } from '../packages/workflow-contracts/dist/schemas.js';
import { actionRegistrySchema } from '../packages/action-registry/dist/schemas.js';

if (process.version !== 'v24.21.0') throw new Error('Schema export requires Node v24.21.0');
if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('Unknown argument');
const check = process.argv.includes('--check');

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  }
  return value;
}

const schemas = [
  ...Object.entries(artifactSchemas).map(([name, schema]) => ['workflow-contracts', name, schema]),
  ['action-registry', 'action-registry', actionRegistrySchema],
];
for (const [pkg, name, schema] of schemas) {
  const file = new URL(`../packages/${pkg}/schemas/v1/${name}.schema.json`, import.meta.url);
  const expected = JSON.stringify(sorted(schema), null, 2) + '\n';
  if (check) {
    const actual = await readFile(file, 'utf8');
    if (actual !== expected) throw new Error(`Schema export differs: ${pkg}/${name}`);
  } else {
    await mkdir(new URL('.', file), { recursive: true });
    await writeFile(file, expected, 'utf8');
  }
}
console.log(`${schemas.length} schema exports ${check ? 'verified' : 'generated'}`);
