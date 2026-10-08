// SPDX-License-Identifier: AGPL-3.0-only

import type { CanvasAction } from '../domain/canvas-authoring';

export function ActionIcon({ action }: { action: CanvasAction | 'stocks' | 'transfer' | 'action' }) {
  const paths = {
    stocks: <><path d="M3 3v18h18M6 15l5-5 4 3 6-8m-5 0h5v5"/></>,
    transfer: <path d="M4 12h16m-5-5 5 5-5 5"/>,
    action: <rect x="5" y="5" width="14" height="14" rx="3"/>,
    swap: <><path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/></>,
    bridge: <><path d="M3 18h18M5 18V9m14 9V9M5 9c4 0 4 6 7 6s3-6 7-6M3 7h4m10 0h4"/></>,
    pool: <><path d="M12 3c-3 5-7 9-7 13a7 7 0 0 0 14 0c0-4-4-8-7-13Z"/></>,
    supply: <><path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/></>,
    lending: <><path d="m3 10 9-6 9 6M5 10v9m5-9v9m4-9v9m5-9v9M3 20h18"/></>,
    withdraw: <><path d="M3 8l9-5 9 5M4 20h16M6 17V9m12 8V9M12 11v6m-3-3 3 3 3-3"/></>,
    repay: <><path d="M3 8l9-5 9 5M4 20h16M6 17V9m12 8V9M12 17v-6m-3 3 3-3 3 3"/></>,
    borrow: <><path d="M4 20h16M6 17V9m4 8V9m4 8V9m4 8V9M3 8l9-5 9 5M12 11v6m-3-3 3 3 3-3"/></>,
  };
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[action]}</svg>;
}
