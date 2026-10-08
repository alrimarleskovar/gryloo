// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { useState } from 'react';
import type { EvidenceIdentifier } from '../domain/execution-evidence';

export function ExecutionIdentifier({ identifier, full = false }: { identifier: EvidenceIdentifier; full?: boolean }) {
  const { t: tr } = useLocale();
  const [copied, setCopied] = useState<string | null>(null), [failed, setFailed] = useState(false);
  const { value, label, kind, explorer } = identifier;
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(value); setFailed(false); }
    catch { setFailed(true); }
  }
  return <div className="execution-identifier">
    <span className="execution-identifier-label">{tr(label)}</span>
    <div className="execution-transaction"><span title={tr(value)}>{tr(full || value.length <= 22 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`)}</span>
      <button type="button" aria-label={tr(`Copy ${kind === 'reference' ? label : kind} ${value}`)} onClick={() => void copy()}>{tr(copied === value ? 'Copied' : 'Copy')}</button>
      <span className="sr-only" role="status">{tr(copied === value ? `${label} copied.` : '')}</span>
      {kind === 'transaction' && explorer && <a href={explorer} target="_blank" rel="noopener noreferrer">{tr("View transaction")}</a>}
      {failed && <span role="status">{tr("Copy unavailable. ")}{tr(label)}: {tr(value)}</span>}
    </div>
    {full && identifier.status && <span className="execution-identifier-status">{tr(identifier.status)}</span>}
  </div>;
}
