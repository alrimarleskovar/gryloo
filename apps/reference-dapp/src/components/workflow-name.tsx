// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useRef, useState } from 'react';

/** Session identity only: renaming does not edit the canonical workflow or its revision. */
export function WorkflowName({ name, rename }: { name: string; rename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    if (editing) { input.current?.focus(); input.current?.select(); }
  }, [editing]);
  function confirm() {
    if (!cancelled.current && draft.trim()) rename(draft.trim());
    setEditing(false);
  }
  return <div className="canvas-name">
    {editing ? <input ref={input} aria-label="Workflow name" value={draft} maxLength={80}
      onChange={event => setDraft(event.target.value)} onBlur={confirm}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation();
          if (event.key === 'Escape') { cancelled.current = true; setEditing(false); }
          else confirm();
        }
      }}/>
      : <><h2>{name}</h2><button type="button" className="workflow-rename" aria-label="Rename workflow" title="Rename workflow"
        onClick={() => { cancelled.current = false; setDraft(name); setEditing(true); }}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z"/></svg>
      </button></>}
  </div>;
}
