// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: automation logging is content-free by construction. Only allowlisted field names pass, and only values shaped
 * like closed codes, opaque ids (rule, occurrence, handoff), counts or durations: never an owner address, a wallet, a channel address,
 * an approval link, a token, a signature or a secret. Anything else is dropped before it reaches the sink.
 *
 * Events: automation.evaluated, automation.trigger_matched, automation.condition_not_met (on state changes only),
 * automation.occurrence_created, automation.approval_requested, automation.notification_attempted, automation.paused,
 * automation.resumed, automation.archived, automation.expired, automation.dispatch, automation.*_failed.
 */
type Fields = Readonly<Record<string, string | number | boolean | null | undefined>>;
export type AutomationLogSink = { readonly info: (event: string, fields?: Fields) => void; readonly warn: (event: string, fields?: Fields) => void };
export type AutomationLogger = AutomationLogSink;

const ALLOWED = new Set(['rule', 'occurrence', 'handoff', 'kind', 'outcome', 'code', 'count', 'missed', 'duration_ms', 'channel', 'status', 'source', 'evidence', 'asset',
  'state', 'enqueued', 'processed', 'expired', 'synced', 'truncated', 'delivery', 'duplicate', 'version']);
const SAFE_STRING = /^(?:[A-Z][A-Z0-9_]{1,80}|aut_[a-z2-7]{26}|occ_[a-z2-7]{26}|apr_[a-z2-7]{26}|[a-z]{2,16})$/;
function clean(fields: Fields = {}): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED.has(key) || value === undefined) continue;
    if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) out[key] = value;
    else if (typeof value === 'string' && SAFE_STRING.test(value)) out[key] = value;
  }
  return out;
}
const event = (name: string) => /^automation\.[a-z_.]{2,60}$/.test(name) ? name : 'automation.event';
export function automationLogger(sink?: AutomationLogSink | null): AutomationLogger {
  return { info: (name, fields) => sink?.info(event(name), clean(fields)), warn: (name, fields) => sink?.warn(event(name), clean(fields)) };
}
let routeSink: Promise<AutomationLogSink> | null = null;
/** The structured log sink of the automation routes and server actions (one per process). */
export const automationRouteLogger = () => routeSink ??= import('@defi-workflow-engine/cloud-runtime').then(runtime => runtime.createLogger({ service: 'flofi-automations' }));
