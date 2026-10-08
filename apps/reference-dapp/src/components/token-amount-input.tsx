// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import type { ComponentProps } from 'react';

/** Entry formatting only: leave precision and invalid input to the existing validators. */
export function normalizeAmountEntry(value: string): string {
  if (!/^\d*(?:\.\d*)?$/.test(value)) return value;
  const [integer, fraction] = value.split('.');
  const whole = integer!.replace(/^0+(?=\d)/, '');
  return fraction === undefined ? whole : `${whole || '0'}.${fraction}`;
}

type Props = Omit<ComponentProps<'input'>, 'value' | 'defaultValue' | 'onChange'> & {
  value: string; onValueChange(value: string): void;
};

/** A zero starting value is replaced on entry; an empty field stays editable until blur. */
export function TokenAmountInput({ value, onValueChange, onFocus, onClick, onBlur, onKeyDown, onBeforeInput, onPaste, ...props }: Props) {
  const { t: tr } = useLocale();
  return <input type="text" inputMode="decimal" autoComplete="off" spellCheck={false} placeholder={tr("0")} {...props}
    value={value} onChange={event => onValueChange(normalizeAmountEntry(event.target.value))}
    onFocus={event => { if (event.currentTarget.value === '0') event.currentTarget.select(); onFocus?.(event); }}
    onClick={event => { if (event.currentTarget.value === '0') event.currentTarget.select(); onClick?.(event); }}
    onKeyDown={event => { if (event.currentTarget.value === '0' && !event.ctrlKey && !event.metaKey && !event.altKey && /^[0-9.]$/.test(event.key)) event.currentTarget.select(); onKeyDown?.(event); }}
    onBeforeInput={event => { if (event.currentTarget.value === '0') event.currentTarget.select(); onBeforeInput?.(event); }}
    onPaste={event => { if (event.currentTarget.value === '0') event.currentTarget.select(); onPaste?.(event); }}
    onBlur={event => { if (event.currentTarget.value === '') onValueChange('0'); onBlur?.(event); }}/>
}
