// SPDX-License-Identifier: AGPL-3.0-only
export const SECONDARY_WORKSPACES = [
  { id: 'workflows', label: 'Your workflows', href: '/app/workflows' },
  { id: 'credentials', label: 'Credentials', href: '/app/credentials' },
  { id: 'agents', label: 'Agents', href: '/app/agents' },
  { id: 'passkeys', label: 'Passkeys', href: '/app/passkeys' },
] as const;

export type SecondaryWorkspace = typeof SECONDARY_WORKSPACES[number];

export function secondaryWorkspaceRoute(pathname: string | null | undefined): SecondaryWorkspace | null {
  return SECONDARY_WORKSPACES.find(item => item.href === pathname?.replace(/\/$/, '')) ?? null;
}
