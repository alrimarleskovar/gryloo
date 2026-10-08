// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the classified refusal of a shared FloFi platform operation. Its message is a closed code
 * (`^[A-Z][A-Z0-9_]{2,80}$`); `extra` carries only non-secret detail (schema issues, gate facts, step views). Each surface (MCP,
 * Developer API, channels) maps it to its own error shape; the platform never formats transport errors itself.
 */
export class PlatformRefusal extends Error {
  readonly extra: Readonly<Record<string, unknown>>;
  constructor(code: string, extra: Readonly<Record<string, unknown>> = {}) {
    super(code);
    this.extra = extra;
  }
}
export const refuse = (code: string, extra: Readonly<Record<string, unknown>> = {}): never => { throw new PlatformRefusal(code, extra); };
