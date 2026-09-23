// SPDX-License-Identifier: AGPL-3.0-only
export function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'info' | 'warning' }) {
  return <span className={`status-badge ${tone}`}>{label}</span>;
}
