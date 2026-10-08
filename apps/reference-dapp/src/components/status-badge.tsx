// SPDX-License-Identifier: AGPL-3.0-only

import { useLocale } from '../i18n/locale';
export function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'info' | 'warning' }) {
  const { t: tr } = useLocale();
  return <span className={`status-badge ${tone}`}>{tr(label)}</span>;
}
