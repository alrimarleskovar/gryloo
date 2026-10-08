// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the operator CLI for FloFi Developer projects, run directly by Node 24's TypeScript support:
 *
 *   node apps/reference-dapp/backend/developer-admin.ts <command> (--tenant <id> | --preview-branch <branch>) [options]
 *
 *   create-project  --name <display name>              a new ACTIVE project (the name end users see on /approve)
 *   create-key      --project <prj_…> [--scopes a,b] [--key-file <path>]
 *                                                       a new SANDBOX key (all four scopes by default), shown ONCE: printed, or
 *                                                       written to a new mode-0600 file when --key-file is given
 *   revoke-key      --key <key_…>
 *   list-keys       --project <prj_…>                  ids, hints, scopes and status (never a key)
 *   disable-project --project <prj_…>                  every key stops working; open approvals are revoked
 *   deliveries      --project <prj_…> [--limit 50]     read-only webhook delivery state
 *
 * Environment: DATABASE_URL (the deployment's database) and FLOFI_DEVELOPER_SECRET (the deployment's developer secret: a key only
 * authenticates where the digest key matches). The tenant is explicit: production/local `--tenant default`, a Vercel Preview
 * `--preview-branch <git branch>`. Production (live) keys cannot be issued in this build. Like `main.ts`, it runs on plain Node: every
 * module it reaches imports with explicit extensions (`backend/developer-admin.test.ts`).
 */
import { open, rm } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { assertSchemaCurrent, createDatabase, ensureTenant, SHIPPED_MIGRATIONS } from '@defi-workflow-engine/cloud-runtime';
import { createPgHandoffStore } from '../src/platform/handoff-store.ts';
import { deploymentTenant } from '../src/server/deployment.ts';
import { createProject, disableProject, issueSandboxKey, listDeliveries, listKeys, revokeKey, type AdminDeps } from '../src/developer/admin.ts';
import { developerKey, type DeveloperScope } from '../src/developer/config.ts';
import { createPgDeveloperStore } from '../src/developer/pg-store.ts';

const COMMANDS = ['create-project', 'create-key', 'revoke-key', 'list-keys', 'disable-project', 'deliveries'] as const;
type Command = (typeof COMMANDS)[number];

function tenantOf(values: { tenant?: string | undefined; 'preview-branch'?: string | undefined }): string {
  if (Boolean(values.tenant) === Boolean(values['preview-branch'])) throw new Error('TENANT_REQUIRED: pass exactly one of --tenant or --preview-branch');
  return values.tenant ? deploymentTenant({ TENANT_ID: values.tenant }) : deploymentTenant({ VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: values['preview-branch'] });
}
const required = (value: string | undefined, flag: string) => { if (!value) throw new Error(`ARGUMENT_REQUIRED: --${flag}`); return value; };

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || !(COMMANDS as readonly string[]).includes(command)) throw new Error(`COMMAND_INVALID: one of ${COMMANDS.join(', ')}`);
  const { values } = parseArgs({ args: rest, strict: true, allowPositionals: false, options: { tenant: { type: 'string' }, 'preview-branch': { type: 'string' },
    name: { type: 'string' }, project: { type: 'string' }, key: { type: 'string' }, scopes: { type: 'string' }, 'key-file': { type: 'string' }, limit: { type: 'string' } } });
  const tenantId = tenantOf(values), databaseUrl = process.env.DATABASE_URL ?? '', secret = process.env.FLOFI_DEVELOPER_SECRET ?? '';
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) throw new Error('DATABASE_URL_REQUIRED');
  if (secret.length < 32 || secret.length > 512) throw new Error('FLOFI_DEVELOPER_SECRET_INVALID');
  const db = createDatabase({ connectionString: databaseUrl, maxConnections: 2, applicationName: 'flofi-developer-admin' });
  try {
    await assertSchemaCurrent(db, SHIPPED_MIGRATIONS);
    await ensureTenant(db, tenantId);
    const deps: AdminDeps = { store: createPgDeveloperStore(db, tenantId), handoffs: createPgHandoffStore(db, tenantId),
      config: { keys: { apiKey: developerKey(secret, 'api-key') } }, now: () => new Date() };
    const out = await run(command as Command, values, deps);
    process.stdout.write(JSON.stringify({ tenantId, ...out }, null, 2) + '\n');
  } finally { await db.close(); }
}

async function run(command: Command, values: Record<string, string | boolean | undefined>, deps: AdminDeps): Promise<Record<string, unknown>> {
  const flag = (name: string) => typeof values[name] === 'string' ? values[name] as string : undefined;
  switch (command) {
    case 'create-project': return createProject(deps, required(flag('name'), 'name'));
    case 'create-key': {
      const scopes = flag('scopes')?.split(',').map(s => s.trim()).filter(Boolean) as DeveloperScope[] | undefined, project = required(flag('project'), 'project');
      const keyFile = flag('key-file');
      if (!keyFile) {
        const issued = await issueSandboxKey(deps, project, scopes);
        process.stderr.write('The key below is shown once. Store it in your server\'s secret manager; FloFi keeps only a digest.\n');
        return { keyId: issued.keyId, hint: issued.hint, environment: issued.environment, scopes: issued.scopes, key: issued.key };
      }
      // The file is created first (`wx`: never overwrite; 0600: the operator only), so a key is never issued that cannot be delivered.
      const file = await open(keyFile, 'wx', 0o600).catch((error: { code?: string }) => { throw new Error(error.code === 'EEXIST' ? 'KEY_FILE_EXISTS' : 'KEY_FILE_UNWRITABLE'); });
      let written = false;
      try {
        const issued = await issueSandboxKey(deps, project, scopes);
        await file.writeFile(issued.key + '\n', 'utf8');
        written = true;
        return { keyId: issued.keyId, hint: issued.hint, environment: issued.environment, scopes: issued.scopes, keyFile };
      } finally {
        await file.close().catch(() => undefined);
        if (!written) await rm(keyFile, { force: true });
      }
    }
    case 'revoke-key': return revokeKey(deps, required(flag('key'), 'key'));
    case 'list-keys': return { keys: await listKeys(deps, required(flag('project'), 'project')) };
    case 'disable-project': return disableProject(deps, required(flag('project'), 'project'));
    case 'deliveries': return { deliveries: await listDeliveries(deps, required(flag('project'), 'project'), Number(flag('limit') ?? '50') || 50) };
  }
}

main().catch(error => {
  // A fixed code (and the argument it names), never a stack, a connection string or a secret.
  const code = (error as { code?: unknown }).code;
  const message = typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS') ? 'ARGUMENTS_INVALID'
    : error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}(: [^\n]{0,200})?$/.test(error.message) ? error.message : 'DEVELOPER_ADMIN_FAILED';
  process.stderr.write(message + '\n');
  process.exitCode = 1;
});
