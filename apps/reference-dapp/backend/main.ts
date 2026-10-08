// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Flofi backend entry point (BUILD-CLOUD-001), run directly by Node 24's TypeScript support:
 *
 *   node apps/reference-dapp/backend/main.ts migrate          apply pending schema migrations (deploy step)
 *   node apps/reference-dapp/backend/main.ts api              stateless HTTP API (N replicas)
 *   node apps/reference-dapp/backend/main.ts worker           reconciliation/evidence worker (N replicas)
 *   node apps/reference-dapp/backend/main.ts import-journal <flow> <absolute journal dir> <run id>
 *                                                            copy one validated local run log into PostgreSQL
 *
 * Configuration is environment-only (see docs/deploy/CLOUD.md). The backend holds no key, signs nothing and
 * has no transaction submission path; API and worker refuse to start against an unmigrated schema.
 */
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { assertSchemaCurrent, createDatabase, createHttpServer, createLogger, createPostgresWorkQueue, createWorker, migrate,
  readEvidenceStore, readRuntimeConfig, sweep } from '@defi-workflow-engine/cloud-runtime';
import { createFileLogStore, utf8 } from '@defi-workflow-engine/reference-executor';
import { createRobinhoodTransferService } from '../src/server/robinhood-transfer-service.ts';
import { createSupplyService } from '../src/server/supply-service.ts';
import { validatePublicRunLog } from '../src/server/public-testnet-service.ts';
import { createBackend } from './app.ts';
import { flowMode, FLOWS, isFlowName, type FlowName } from './flows.ts';

const [command, ...rest] = process.argv.slice(2);
const logger = createLogger({ service: `flofi-${command ?? 'backend'}` });
// Startup stage reported by `backend.failed`: a fixed label, never configuration or exception text.
let stage = 'command';

async function main(): Promise<void> {
  if (command === 'migrate') {
    stage = 'config';
    const config = readRuntimeConfig(process.env, 'migrate');
    stage = 'migrate';
    const db = createDatabase({ connectionString: config.migrationDatabaseUrl, maxConnections: 1, applicationName: 'flofi-migrate' });
    try { logger.info('migrate.applied', { versions: (await migrate(db)).join(',') || 'none', schema_version: await assertSchemaCurrent(db) }); }
    finally { await db.close(); }
    return;
  }
  if (command === 'import-journal') {
    const [flow, directory, runId] = rest;
    if (!flow || !isFlowName(flow) || !directory || !isAbsolute(directory) || !runId || !FLOWS[flow].runId.test(runId)) throw new Error('IMPORT_ARGUMENTS_INVALID');
    const config = readRuntimeConfig(process.env, 'worker');
    // The full flow validator (append-only history rules, provenance) checks the local data before anything is copied.
    const provenance = flowMode(flow, process.env) === 'harness' ? 'MOCKED' : 'PUBLIC_TESTNET';
    const offline = () => Promise.reject(new Error('IMPORT_OFFLINE'));
    let bytes: Uint8Array | null;
    if (flow === 'base-sepolia-swap') {
      // The local swap journal keeps one overwritten snapshot (`<id>.json`): it becomes the first line of the durable log.
      const snapshot = await readFile(join(directory, runId + '.json'), 'utf8');
      bytes = new TextEncoder().encode(JSON.stringify(JSON.parse(snapshot)) + '\n');
      validatePublicRunLog(bytes);
    } else {
      await (flow === 'robinhood-transfer' ? createRobinhoodTransferService({ journalDir: directory, provenance, rpc: offline })
        : createSupplyService({ journalDir: directory, provenance, rpc: offline })).load(runId);
      bytes = await createFileLogStore(directory).read(runId + '.jsonl');
    }
    if (!bytes) throw new Error('IMPORT_SOURCE_MISSING');
    const source: Uint8Array = bytes;
    const db = createDatabase({ connectionString: config.databaseUrl, maxConnections: 2, applicationName: 'flofi-import' });
    try {
      await assertSchemaCurrent(db);
      const backend = createBackend({ db, env: process.env, logger, tenantId: config.tenantId, holderId: config.workerId, evidenceStore: null });
      const { log } = backend.storage(flow, config.tenantId);
      // Byte-identical copy; projections and required work are derived in the same transaction.
      await log.extend(runId + '.jsonl', source, () => undefined);
      logger.info('import.completed', { flow, run_id: runId, byte_length: source.length, lines: utf8(source).trimEnd().split('\n').length });
    } finally { await db.close(); }
    return;
  }
  if (command !== 'api' && command !== 'worker') throw new Error('COMMAND_INVALID');
  stage = 'config';
  const config = readRuntimeConfig(process.env, command);
  stage = 'database';
  const db = createDatabase({ connectionString: config.databaseUrl, maxConnections: config.databasePoolMax, applicationName: `flofi-${command}` });
  stage = 'schema';
  const schema = await assertSchemaCurrent(db);
  stage = 'evidence_store';
  const evidenceStore = readEvidenceStore(process.env);
  stage = 'backend';
  const backend = createBackend({ db, env: process.env, logger, tenantId: config.tenantId, holderId: config.workerId, evidenceStore });
  stage = 'flow_modes';
  const modes = Object.fromEntries((Object.keys(FLOWS) as FlowName[]).map(flow => [flow, flowMode(flow, process.env)]));
  logger.info(`${command}.starting`, { schema_version: schema, tenant_id: config.tenantId, worker_id: config.workerId,
    evidence_store: evidenceStore?.id ?? 'none', flows: JSON.stringify(modes) });
  stage = command;

  if (command === 'api') {
    const server = createHttpServer({ routes: backend.routes, logger, authToken: config.apiAuthToken,
      ready: async () => { await db.query('SELECT 1'); return true; } });
    server.keepAliveTimeout = 65_000;
    server.listen(config.port, config.host, () => logger.info('api.listening', { port: config.port }));
    const shutdown = () => { logger.info('api.stopping'); server.close(() => { db.close().finally(() => process.exit(0)); }); setTimeout(() => process.exit(0), 25_000).unref(); };
    process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
    return;
  }
  if (!evidenceStore) throw new Error('EVIDENCE_STORE_REQUIRED');
  // BUILD-CLOUD-PARITY-001: a worker serves only its deployment's tenant, so a shared database never mixes deployments' runs.
  // BUILD-AUTOMATION-001: and it claims only the work kinds it has handlers for: another service's items (the web runtime's
  // `automation.*` work, processed by /api/automations/dispatch) are left to that service instead of being dead-lettered here.
  const handlers = backend.handlers, tenantQueue = createPostgresWorkQueue({ db, ownerId: config.workerId, tenantId: config.tenantId });
  const queue = { ...tenantQueue, claim: (limit: number) => tenantQueue.claim(limit, Object.keys(handlers)) };
  const worker = createWorker({ queue, handlers, logger, workerId: config.workerId, concurrency: config.workerConcurrency,
    sweep: () => sweep(db, { tenantId: config.tenantId }) });
  const shutdown = () => { logger.info('worker.stopping'); worker.stop().finally(() => db.close().finally(() => process.exit(0))); setTimeout(() => process.exit(1), 120_000).unref(); };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
  await worker.start();
}

main().catch(error => {
  // Only classified codes are logged: driver messages can embed connection details.
  const sqlState = (error as { code?: unknown; cause?: { code?: unknown } }).code ?? (error as { cause?: { code?: unknown } }).cause?.code;
  logger.error('backend.failed', { command, stage, error_code: error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message) ? error.message : 'UNCLASSIFIED_ERROR',
    sql_state: typeof sqlState === 'string' && /^[0-9A-Z]{5}$/.test(sqlState) ? sqlState : undefined,
    system_error: typeof sqlState === 'string' && /^E[A-Z]{2,20}$/.test(sqlState) ? sqlState : undefined,
    node_error: typeof sqlState === 'string' && /^ERR_[A-Z0-9_]{1,60}$/.test(sqlState) ? sqlState : undefined,
    error_type: error instanceof Error && /^[A-Za-z]{1,40}Error$/.test(error.name) ? error.name : undefined });
  process.exit(1);
});
