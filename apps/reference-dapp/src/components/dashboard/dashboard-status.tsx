// SPDX-License-Identifier: AGPL-3.0-only

import { useLocale } from '../../i18n/locale';
import type { DashboardStatus } from '../../lib/dashboard/types';

// Presentation only: the existing projection remains the authority for status.
const tones: Record<DashboardStatus, string> = {
  Completed: 'complete',
  'Completed with attention': 'attention',
  'In progress': 'progress',
  'Needs attention': 'attention',
  'Partially completed': 'attention',
  Failed: 'failed',
  Unresolved: 'attention',
  'Transaction not submitted': 'neutral',
  'Not started': 'neutral',
};

export function DashboardStatusBadge({ status }: { status: DashboardStatus }) {
  const { t: tr } = useLocale();
  return <span className={`dashboard-status dashboard-status-${tones[status]}`}><span className="dashboard-status-marker" aria-hidden="true"/>{tr(status)}</span>;
}
