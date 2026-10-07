// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-CHANNELS-001: an invisible helper on `/approve`. For a proposal that came from a conversational channel (a `flofi_chs_` link),
 * it pings the server while the page is open and visible, so the conversation hears when the owner loaded the proposal and when the
 * execution the owner signs in FloFi reaches a terminal state. It renders nothing, shows nothing and decides nothing; any other link
 * (MCP, developer) stops it at once. The secret is read where /approve keeps it (the fragment, then this tab's session storage under the
 * key `approval-handoff.tsx` uses).
 */
import { useEffect } from 'react';
import { channelApprovalPing } from '../app/channel-approve-action';

const CHANNEL_SECRET = /^flofi_chs_[A-Za-z0-9_-]{43}$/;
export const APPROVAL_SECRET_STORAGE_KEY = 'flofi.approval.secret';
const INTERVAL_MS = 20_000, FIRST_MS = 3_000, MAX_MS = 30 * 60_000;
function channelSecret(): string | null {
  const fromHash = decodeURIComponent(window.location.hash.slice(1));
  if (CHANNEL_SECRET.test(fromHash)) return fromHash;
  try { const stored = sessionStorage.getItem(APPROVAL_SECRET_STORAGE_KEY); return stored && CHANNEL_SECRET.test(stored) ? stored : null; } catch { return null; }
}

export function ChannelProgressPing() {
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const tick = async () => {
      const secret = channelSecret();
      if (stopped || !secret || Date.now() - started > MAX_MS) return;
      if (document.visibilityState === 'visible') {
        const result = await channelApprovalPing(secret).catch(() => null);
        if (result && (!result.channel || !result.active)) return;
      }
      timer = setTimeout(() => void tick(), INTERVAL_MS);
    };
    timer = setTimeout(() => void tick(), FIRST_MS);
    return () => { stopped = true; clearTimeout(timer); };
  }, []);
  return null;
}
