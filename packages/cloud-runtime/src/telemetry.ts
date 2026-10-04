// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Vendor-neutral structured telemetry. One JSON object per line on stdout with OpenTelemetry-compatible
 * correlation fields (`trace_id`, `span_id`, `parent_span_id`) and W3C `traceparent` propagation from the
 * BFF through the API, the durable work item and the worker. Any collector (OTel Collector, Railway, Vector,
 * Datadog agent, …) can ingest it; exporting OTLP directly is a future adapter behind `LogSink`.
 * Values are redacted by key and by shape before they are written: no secret, token, authorization header,
 * signature or credential-bearing URL is logged.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

export type FieldValue = string | number | boolean | null | undefined;
export type LogFields = Readonly<Record<string, FieldValue>>;
export type LogSink = (line: string) => void;
export interface Logger {
  readonly info: (event: string, fields?: LogFields) => void;
  readonly warn: (event: string, fields?: LogFields) => void;
  readonly error: (event: string, fields?: LogFields) => void;
  readonly child: (fields: LogFields) => Logger;
}
export type TraceContext = { readonly traceId: string; readonly spanId: string; readonly parentSpanId: string | null };

const SENSITIVE_KEY = /secret|token|password|passwd|authorization|cookie|private|seed|mnemonic|signature|api[-_]?key|credential|access[-_]?key/i;
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;
const trace = new AsyncLocalStorage<TraceContext>();

/** Removes credentials from strings: URL userinfo/query strings, bearer tokens and long hex blobs (signatures). */
export function redactValue(value: FieldValue): FieldValue {
  if (typeof value !== 'string') return value;
  const cleaned = value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, '$1?[REDACTED]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/0x[0-9a-fA-F]{129,}/g, '0x[REDACTED]');
  return cleaned.length > 500 ? cleaned.slice(0, 500) + '…' : cleaned;
}
export function redactFields(fields: LogFields): Record<string, FieldValue> {
  const result: Record<string, FieldValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    result[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactValue(value);
  }
  return result;
}

export function createLogger(input: { service: string; sink?: LogSink; fields?: LogFields; now?: () => Date }): Logger {
  const sink = input.sink ?? (line => { process.stdout.write(line + '\n'); });
  const now = input.now ?? (() => new Date());
  const base = { service: input.service, ...input.fields };
  const write = (severity: 'INFO' | 'WARN' | 'ERROR', event: string, fields: LogFields = {}) => {
    const context = trace.getStore();
    const record = redactFields({ ...base, ...fields });
    sink(JSON.stringify({ timestamp: now().toISOString(), severity, event, ...record,
      ...context ? { trace_id: context.traceId, span_id: context.spanId, parent_span_id: context.parentSpanId ?? undefined } : {} }));
  };
  return {
    info: (event, fields) => write('INFO', event, fields),
    warn: (event, fields) => write('WARN', event, fields),
    error: (event, fields) => write('ERROR', event, fields),
    child: fields => createLogger({ ...input, fields: { ...input.fields, ...fields } }),
  };
}

const hex = (bytes: number) => randomBytes(bytes).toString('hex');
export function parseTraceparent(header: string | null | undefined): TraceContext | null {
  const match = typeof header === 'string' ? TRACEPARENT.exec(header.trim()) : null;
  if (!match || /^0+$/.test(match[1]!) || /^0+$/.test(match[2]!)) return null;
  return { traceId: match[1]!, spanId: match[2]!, parentSpanId: null };
}
export function formatTraceparent(context: TraceContext): string { return `00-${context.traceId}-${context.spanId}-01`; }
export function currentTrace(): TraceContext | null { return trace.getStore() ?? null; }
export function currentTraceparent(): string | null { const context = trace.getStore(); return context ? formatTraceparent(context) : null; }

/** Runs `action` in a child span of the current (or given remote) trace and logs its outcome and duration. */
export async function withSpan<T>(logger: Logger, name: string, fields: LogFields, action: () => Promise<T>,
  remoteParent?: TraceContext | null): Promise<T> {
  const parent = remoteParent ?? trace.getStore() ?? null;
  const context: TraceContext = { traceId: parent?.traceId ?? hex(16), spanId: hex(8), parentSpanId: parent?.spanId ?? null };
  return trace.run(context, async () => {
    const started = performance.now();
    try {
      const result = await action();
      logger.info(name, { ...fields, outcome: 'ok', duration_ms: Math.round(performance.now() - started) });
      return result;
    } catch (error) {
      const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message) ? error.message : 'UNCLASSIFIED_ERROR';
      logger.warn(name, { ...fields, outcome: 'error', error_code: code, duration_ms: Math.round(performance.now() - started) });
      throw error;
    }
  });
}
