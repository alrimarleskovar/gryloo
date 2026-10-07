// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: channel logging is content-free by construction. Only allowlisted field names pass, and only values shaped like
 * closed codes, opaque ids, counts or durations: never a message text, a provider sender id, a phone number, an address, a URL, an
 * approval link, a token or a secret. Anything else is dropped before it reaches the sink.
 */
type Fields = Readonly<Record<string, string | number | boolean | null | undefined>>;
export type ChannelLogSink = { readonly info: (event: string, fields?: Fields) => void; readonly warn: (event: string, fields?: Fields) => void };
export type ChannelLogger = ChannelLogSink;

const ALLOWED = new Set(['channel', 'outcome', 'code', 'conversation', 'count', 'duration_ms', 'kind', 'attempts', 'status', 'action', 'events', 'duplicates', 'ignored',
  'deliveries', 'sent', 'failed', 'skipped']);
const SAFE_STRING = /^(?:[A-Z][A-Z0-9_]{1,80}|chc_[a-z2-7]{26}|cho_[a-z2-7]{26}|apr_[a-z2-7]{26}|[a-z]{2,16})$/;
function clean(fields: Fields = {}): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED.has(key) || value === undefined) continue;
    if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) out[key] = value;
    else if (typeof value === 'string' && SAFE_STRING.test(value)) out[key] = value;
  }
  return out;
}
const event = (name: string) => /^channel\.[a-z_.]{2,60}$/.test(name) ? name : 'channel.event';
export function channelLogger(sink?: ChannelLogSink | null): ChannelLogger {
  return { info: (name, fields) => sink?.info(event(name), clean(fields)), warn: (name, fields) => sink?.warn(event(name), clean(fields)) };
}
