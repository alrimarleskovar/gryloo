// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: the one module-resolution rule the backend needs to load FloFi's shared engine on plain Node.
 *
 * `backend/main.ts` runs under Node's native TypeScript type stripping, without a bundler. Node resolves only exact specifiers, but the
 * engine, domain and platform modules under `src/` are written for `moduleResolution: "Bundler"` (Next.js, Vitest and `tsc` resolve
 * `'../domain/commands'` to `commands.ts`), so a plain-Node import of them fails with ERR_MODULE_NOT_FOUND. That is the only obstacle:
 * the same closure has no JSX, no non-erasable TypeScript and no import cycle that Node cannot load.
 *
 * This hook reproduces exactly that bundler rule and nothing else: when Node cannot resolve a RELATIVE specifier written WITHOUT an
 * extension by a module INSIDE `apps/reference-dapp/src/`, it retries `<specifier>.ts`, accepted only if that file exists and is also
 * inside `src/`. Specifiers Node resolves itself (every existing backend import) never reach it; packages, absolute paths, `index`
 * directories, `.tsx` and anything outside `src/` are left to fail as before. It loads the same files the web deployment runs — no
 * second engine. It is installed only by `automation-worker.ts`, i.e. only when the worker's environment enables automations.
 */
import { existsSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src') + sep;
const RELATIVE_WITHOUT_EXTENSION = /^\.\.?\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
const HAS_EXTENSION = /\.(?:[cm]?[jt]sx?|json|node)$/;

/** The bundler resolution of `specifier` from `parentURL`, or null when the rule does not apply. */
export function sourceFallback(specifier: string, parentURL: string | undefined, root = SOURCE_ROOT): string | null {
  if (!RELATIVE_WITHOUT_EXTENSION.test(specifier) || HAS_EXTENSION.test(specifier) || !parentURL?.startsWith('file:')) return null;
  if (!fileURLToPath(parentURL).startsWith(root)) return null;
  const candidate = fileURLToPath(new URL(`${specifier}.ts`, parentURL));
  return candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile() ? pathToFileURL(candidate).href : null;
}

let installed = false;
/** Installs the rule once per process (synchronous in-thread hooks, Node ≥ 22.15 / 24). */
export function installSourceResolution(): void {
  if (installed) return;
  installed = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try { return nextResolve(specifier, context); }
      catch (error) {
        const fallback = (error as { code?: unknown }).code === 'ERR_MODULE_NOT_FOUND' ? sourceFallback(specifier, context.parentURL) : null;
        if (!fallback) throw error;
        return nextResolve(fallback, context);
      }
    },
  });
}
