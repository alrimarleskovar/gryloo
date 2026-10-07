// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useState } from 'react';
import type { EvidenceIdentifier } from '../domain/execution-evidence';

export function ExecutionIdentifier({ identifier, full = false }: { identifier: EvidenceIdentifier; full?: boolean }) {
  const [copied, setCopied] = useState<string | null>(null), [failed, setFailed] = useState(false);
  const { value, label, kind, explorer } = identifier;
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(value); setFailed(false); }
    catch { setFailed(true); }
  }
  return <div className="execution-identifier">
    <span className="execution-identifier-label">{label}</span>
    <div className="execution-transaction"><span title={value}>{full || value.length <= 22 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`}</span>
      <button type="button" aria-label={`Copy ${kind === 'reference' ? label : kind} ${value}`} onClick={() => void copy()}>{copied === value ? 'Copied' : 'Copy'}</button>
      <span className="sr-only" role="status">{copied === value ? `${label} copied.` : ''}</span>
      {kind === 'transaction' && explorer && <a href={explorer} target="_blank" rel="noopener noreferrer">View transaction</a>}
      {failed && <span role="status">Copy unavailable. {label}: {value}</span>}
    </div>
    {full && identifier.status && <span className="execution-identifier-status">{identifier.status}</span>}
  </div>;
}
