// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useId, useRef, useState } from 'react';

export function HeaderSettings({ onDisconnect, disconnectDisabled }: { onDisconnect: () => void; disconnectDisabled: boolean }) {
  const [open, setOpen] = useState(false);
  // Presentation preferences only; localization and theme application are deferred.
  const [language, setLanguage] = useState<'PT' | 'EN'>('EN');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const container = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      setOpen(false); toggle.current?.focus();
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return <div className="header-settings-control" ref={container}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={toggle} type="button" className="header-settings" aria-label="Settings" title="Settings"
      aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(value => !value)}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m10 3-.5 3-2 1.2L4.7 6l-2 3.5 2.3 2v1l-2.3 2 2 3.5 2.8-1.2 2 1.2.5 3h4l.5-3 2-1.2 2.8 1.2 2-3.5-2.3-2v-1l2.3-2-2-3.5-2.8 1.2-2-1.2-.5-3Z"/><circle cx="12" cy="12" r="3"/></svg>
    </button>
    {open && <div className="header-settings-menu" id={menuId} role="group" aria-label="Settings options">
      <div className="header-settings-row"><span>Language</span><div className="header-settings-choices" role="group" aria-label="Language">
        {(['PT', 'EN'] as const).map(value => <button key={value} type="button" aria-pressed={language === value} title={value === 'PT' ? 'Português' : 'English'} onClick={() => setLanguage(value)}>{value}</button>)}
      </div></div>
      <div className="header-settings-row"><span>Theme</span><div className="header-settings-choices" role="group" aria-label="Theme">
        <button type="button" aria-label="Light theme" title="Light theme" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>
        </button>
        <button type="button" aria-label="Dark theme" title="Dark theme" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.5 14.5A9 9 0 0 1 9.5 3.5a9 9 0 1 0 11 11Z"/></svg>
        </button>
      </div></div>
      <button type="button" className="header-disconnect" disabled={disconnectDisabled}
        title="Clear this app’s wallet connection. Wallet permissions are managed in your wallet."
        onClick={() => { onDisconnect(); setOpen(false); toggle.current?.focus(); }}>Disconnect</button>
    </div>}
  </div>;
}
