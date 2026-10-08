// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { useEffect, useId, useRef, useState } from 'react';
import { walletEnvironmentLabel, type WalletEnvironment } from '../wallet/environment';

const choices = ['testnet', 'mainnet'] as const;

/** The selected value always follows the wallet; choosing an option only requests a switch. */
export function HeaderEnvironment({ environment, disabled, onChange }: {
  environment: WalletEnvironment; disabled: boolean; onChange(value: typeof choices[number]): void;
}) {
  const { t: tr } = useLocale();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const expanded = open && !disabled;
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  function show() {
    setActive(environment === 'mainnet' ? 1 : 0);
    setOpen(true);
  }
  function choose(value: typeof choices[number]) {
    setOpen(false);
    trigger.current?.focus();
    onChange(value);
  }
  useEffect(() => {
    if (!expanded) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [expanded]);
  return <div className="header-environment-control" data-environment={environment} ref={container}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} type="button" className="header-environment" role="combobox" aria-label={tr("Environment")}
      aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? menuId : undefined}
      aria-activedescendant={expanded ? `${menuId}-${active}` : undefined} disabled={disabled}
      onClick={() => { if (expanded) setOpen(false); else show(); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Tab') { setOpen(false); return; }
        if (event.key === 'Escape' && expanded) {
          event.preventDefault(); event.stopPropagation(); setOpen(false); return;
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          if (!expanded) { show(); return; }
          if (event.key === 'Enter' || event.key === ' ') choose(choices[active]!);
          else if (event.key === 'Home') setActive(0);
          else if (event.key === 'End') setActive(choices.length - 1);
          else setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length);
        } else if (/^[mt]$/i.test(event.key)) {
          event.preventDefault(); event.stopPropagation(); setOpen(true); setActive(event.key.toLowerCase() === 'm' ? 1 : 0);
        }
      }}>
      {environment === 'mainnet' && <span className="header-mainnet-dot" aria-hidden="true"/>}
      <span>{tr(walletEnvironmentLabel(environment))}</span>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    {expanded && <ul className="header-environment-menu" id={menuId} role="listbox" aria-label={tr("Environment options")}>
      {choices.map((value, index) => <li key={value} id={`${menuId}-${index}`} role="option"
        aria-selected={environment === value} data-active={active === index ? '' : undefined}
        onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(value)}>
        <span>{tr(walletEnvironmentLabel(value))}</span>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>
      </li>)}
    </ul>}
  </div>;
}
