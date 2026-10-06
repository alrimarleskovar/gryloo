// SPDX-License-Identifier: AGPL-3.0-only
export function dashboardRoute(pathname: string | null | undefined) {
  if (pathname === '/app/dashboard') return { runId: null };
  const match = pathname?.match(/^\/app\/dashboard\/runs\/([^/]+)$/);
  if (!match) return null;
  try { return { runId: decodeURIComponent(match[1]!) }; }
  catch { return { runId: match[1]! }; } // Invalid IDs are handled by the owner-scoped reader, never a fabricated run.
}
