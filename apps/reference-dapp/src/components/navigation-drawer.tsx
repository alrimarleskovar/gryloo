// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { SECONDARY_WORKSPACES as items, secondaryWorkspaceRoute, type SecondaryWorkspace } from '../domain/secondary-workspaces';
import { dashboardRoute } from '../lib/dashboard/routes';
import type { WorkflowStage } from '../domain/product-shell';

type NavigationItem = SecondaryWorkspace['id'] | 'dashboard' | 'build' | 'logout';

function NavigationIcon({ item }: { item: NavigationItem }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {item === 'dashboard' ? <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>
      : item === 'build' ? <><rect x="3" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="16" width="7" height="5" rx="1.5"/><path d="M6.5 8v7a3.5 3.5 0 0 0 3.5 3.5h4M14 5.5h7m-3-3 3 3-3 3"/></>
        : item === 'logout' ? <><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M10 12h11m-4-4 4 4-4 4"/></>
          : item === 'workflows' ? <><path d="M4 3h12l4 4v14H4Z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></>
          : item === 'credentials' ? <><rect x="4" y="3" width="16" height="18" rx="3"/><circle cx="12" cy="9" r="2"/><path d="M8 16c0-3 8-3 8 0"/></>
      : item === 'agents' ? <><rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4M2 12h2m16 0h2M9 16h6"/><path d="M9 11v1m6-1v1"/></>
        : <><circle cx="8" cy="9" r="4"/><path d="m11 12 9 9m-3-3 3-3m-6 0 3-3"/></>}
  </svg>;
}

/** All navigation uses the existing overlay and persistent product shell. */
export function NavigationDrawer({ pathname, section = 'Build', onBuild, onDisconnect, disconnectDisabled }: {
  pathname?: string | null; section?: WorkflowStage | 'Dashboard'; onBuild: () => void;
  onDisconnect: () => void; disconnectDisabled: boolean;
}) {
  const { t: tr } = useLocale();
  const [open, setOpen] = useState(false);
  const selected = secondaryWorkspaceRoute(pathname)?.id
    ?? (dashboardRoute(pathname) || (!pathname && section === 'Dashboard') ? 'dashboard'
      : (!pathname || pathname === '/') && section === 'Build' ? 'build' : null);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const navigation = useRef<HTMLDivElement>(null);
  const firstItem = useRef<HTMLAnchorElement>(null);
  const drawerId = useId();
  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const header = trigger.current?.closest('header');
    if (!header) return;
    function position() {
      const bottom = Math.max(0, Math.min(window.innerHeight, header!.getBoundingClientRect().bottom));
      layer.current?.style.setProperty('--navigation-top', `${bottom}px`);
    }
    position();
    const observer = new ResizeObserver(position);
    observer.observe(header);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    firstItem.current?.focus({ preventScroll: true });
    function outside(event: Event) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) close();
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(true);
    }
    // Keep the header in view without changing body overflow or scrollbar width.
    function preventBackgroundScroll(event: Event) {
      const nav = navigation.current;
      if (!(event.target instanceof Node && nav?.contains(event.target) && nav.scrollHeight > nav.clientHeight)) event.preventDefault();
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    document.addEventListener('wheel', preventBackgroundScroll, { passive: false });
    document.addEventListener('touchmove', preventBackgroundScroll, { passive: false });
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('wheel', preventBackgroundScroll);
      document.removeEventListener('touchmove', preventBackgroundScroll);
    };
  }, [open, close]);

  return <div className="navigation-control" ref={container}>
    <button ref={trigger} type="button" className="navigation-trigger" aria-label={tr(open ? 'Close navigation' : 'Open navigation')}
      aria-expanded={open} aria-controls={drawerId} onClick={() => { if (open) close(true); else { setOpen(true); } }}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
    </button>
    <div ref={layer} className="navigation-layer" data-open={open} aria-hidden={!open} inert={!open}>
      <div className="navigation-backdrop" aria-hidden="true" onClick={() => close(true)}/>
      <aside ref={drawer} id={drawerId} className="navigation-drawer" aria-label={tr("FloFi navigation")}>
        <div ref={navigation} className="navigation-content">
          <p className="navigation-section-label">{tr("Workspace")}</p>
          <nav aria-label={tr("Workspace navigation")}>
            <Link ref={firstItem} href="/app/dashboard" className="navigation-row" aria-current={selected === 'dashboard' ? 'page' : undefined} onClick={() => close(true)}>
              <NavigationIcon item="dashboard"/><span>{tr("Dashboard")}</span>
            </Link>
            <Link href="/" className="navigation-row" aria-current={selected === 'build' ? 'page' : undefined}
              onClick={event => { event.preventDefault(); onBuild(); close(true); }}>
              <NavigationIcon item="build"/><span>{tr("Build Workflow")}</span>
            </Link>
            <hr className="navigation-separator"/>
            {items.map(item => <Link key={item.id} href={item.href}
              className="navigation-row" aria-current={selected === item.id ? 'page' : undefined} onClick={() => close(true)}>
              <NavigationIcon item={item.id}/><span>{tr(item.label)}</span>
            </Link>)}
          </nav>
        </div>
        <div className="navigation-footer">
          <button type="button" className="navigation-row" aria-label={tr("Logout")} disabled={disconnectDisabled}
            onClick={() => { onDisconnect(); close(true); }}><NavigationIcon item="logout"/><span>{tr("Logout")}</span></button>
        </div>
      </aside>
    </div>
  </div>;
}
