// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RunDetailView } from '../components/dashboard/run-detail-view';
import { DashboardView } from '../components/dashboard/dashboard-view';
import { runDetailFixture, type RunDetailCase } from './run-detail-fixture';
import { reviewOwner } from './review-fixture';

type DetailMode = RunDetailCase | 'not-found' | 'unavailable' | 'disconnected' | 'verify' | 'loading';
declare global {
  interface Window {
    flofiRunDetailAcceptance: { show(mode: DetailMode): void; current(): void; longTitle(): void; longValues(): void; counts(): { back: number; reloaded: number; executeNavigation: number; built: number } };
  }
}
function Harness() {
  const [mode, setMode] = useState<DetailMode>('completed'), [current, setCurrent] = useState(false), [long, setLong] = useState(false), [index, setIndex] = useState(false);
  const [stress, setStress] = useState(false);
  const [counts, setCounts] = useState({ back: 0, reloaded: 0, executeNavigation: 0, built: 0 });
  const count = (key: keyof typeof counts) => () => setCounts(value => ({ ...value, [key]: value[key] + 1 }));
  window.flofiRunDetailAcceptance = { show(value) { setMode(value); setIndex(false); setCurrent(false); setLong(false); setStress(false); }, current: () => setCurrent(true), longTitle: () => setLong(true), longValues: () => setStress(true), counts: () => counts };
  const missing = ['not-found', 'unavailable', 'disconnected', 'verify', 'loading'].includes(mode);
  const fixture = runDetailFixture(missing ? 'completed' : mode as RunDetailCase, stress);
  const connection = mode === 'not-found' ? 'NOT_FOUND' : mode === 'unavailable' ? 'UNAVAILABLE' : mode === 'disconnected' ? 'DISCONNECTED' : mode === 'verify' ? 'SIGN_IN_REQUIRED' : 'CONNECTED';
  return index ? <DashboardView account={reviewOwner} connection="CONNECTED" runs={[fixture.view]} hasMore={false} loading={false} build={count('built')} openRun={() => setIndex(false)} verify={() => {}} verifying={false} verificationIssue={null} refresh={count('reloaded')}/>
    : <RunDetailView view={missing ? null : { ...fixture.view, current, ...(long ? { title: 'OwnerDefinedWorkflowName'.repeat(18) } : {}) }} detail={missing ? null : fixture.detail} connection={connection} loading={mode === 'loading'}
      back={() => { count('back')(); setIndex(true); }} build={count('built')} execute={count('executeNavigation')} refresh={count('reloaded')}/>;
}
export function mount(element: HTMLElement) { createRoot(element).render(<Harness/>); }
