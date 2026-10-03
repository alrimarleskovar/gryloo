// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Minimal SQL boundary. Only this module touches the driver, so the store code depends on a two-method
 * interface and any PostgreSQL wire-compatible provider (Neon, Aurora, RDS, self-hosted) can sit behind it.
 * Transactions are short and never span an RPC call; no session state is used, so transaction-mode
 * connection poolers are supported.
 */
import pg from 'pg';

export type Row = Record<string, unknown>;
export interface Queryable {
  readonly query: <R extends Row = Row>(text: string, values?: readonly unknown[]) => Promise<{ rows: R[]; rowCount: number }>;
}
export interface Database extends Queryable {
  /** Runs `work` in one READ COMMITTED transaction; rolls back on any rejection. */
  readonly transaction: <T>(work: (tx: Queryable) => Promise<T>) => Promise<T>;
  readonly close: () => Promise<void>;
}

const RETRYABLE = new Set(['40001', '40P01']);
export function createDatabase(input: { connectionString: string; maxConnections?: number; applicationName?: string }): Database {
  const pool = new pg.Pool({ connectionString: input.connectionString, max: input.maxConnections ?? 10,
    application_name: input.applicationName ?? 'flofi', idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000, query_timeout: 35_000 });
  pool.on('error', () => undefined); // An idle client failure is surfaced to the next query instead of crashing.
  const run = async <R extends Row>(client: pg.Pool | pg.PoolClient, text: string, values?: readonly unknown[]) => {
    const result = await client.query<R>(text, values as unknown[] | undefined);
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  };
  return {
    query: (text, values) => run(pool, text, values),
    async transaction(work) {
      for (let attempt = 0; ; attempt++) {
        const client = await pool.connect();
        let released = false;
        try {
          await client.query('BEGIN');
          const result = await work({ query: (text, values) => run(client, text, values) });
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => { client.release(true); released = true; });
          // Serialization/deadlock aborts are retried once with a fresh transaction; nothing was committed.
          if (attempt === 0 && RETRYABLE.has((error as { code?: string }).code ?? '')) continue;
          throw error;
        } finally { if (!released) client.release(); }
      }
    },
    close: () => pool.end(),
  };
}

export function isUniqueViolation(error: unknown): boolean { return (error as { code?: string }).code === '23505'; }
