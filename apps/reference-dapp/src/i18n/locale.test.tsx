// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HookHarness } from '../test-utils/hook-harness';
import { LocaleProvider, LANGUAGE_KEY, translate, useLocale } from './locale';
import { portuguese } from './pt';
import { YourWorkflows } from '../components/saved-workflows';
import { WorkflowProvider, useWorkflow } from '../state/workflow-store';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { editorReducer, initialEditor } from '../domain/editor';
import { validateSavedWorkflow } from '../domain/saved-workflow';

vi.mock('react', async original => ({ ...await original<typeof import('react')>(), ...(await import('../test-utils/hook-harness')).hookMocks }));
let host: HookHarness, locale: ReturnType<typeof useLocale>, workflow: ReturnType<typeof useWorkflow>;
let storage: Map<string, string>;
const context = createBaseSepoliaReviewContext();
function Probe() { locale = useLocale(); workflow = useWorkflow(); return <span>{locale.t('Save workflow')}</span>; }
const render = () => host.render(() => renderToStaticMarkup(<LocaleProvider><WorkflowProvider initialContext={context}><Probe/></WorkflowProvider></LocaleProvider>));
beforeEach(() => {
  host = new HookHarness(); storage = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal('document', Object.assign(new EventTarget(), { documentElement: { lang: '' } }));
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout, setInterval, clearInterval }));
});
afterEach(() => { host.unmount(); vi.unstubAllGlobals(); });
describe('locale preference and workflow isolation', () => {
  it('switches PT/EN, persists the choice and updates the document language', () => {
    expect(render()).toContain('Save workflow');
    locale.setLanguage('PT'); expect(render()).toContain('Guardar fluxo');
    expect(storage.get(LANGUAGE_KEY)).toBe('PT'); expect(document.documentElement.lang).toBe('pt');
    locale.setLanguage('EN'); expect(render()).toContain('Save workflow');
    expect(storage.get(LANGUAGE_KEY)).toBe('EN'); expect(document.documentElement.lang).toBe('en');
  });
  it('loads the persisted locale and preserves it after unmount/reload', () => {
    storage.set(LANGUAGE_KEY, 'PT'); expect(render()).toContain('Guardar fluxo');
    host.unmount(); host = new HookHarness(); expect(render()).toContain('Guardar fluxo');
    expect(locale.language).toBe('PT');
  });
  it('ignores an invalid saved preference', () => { storage.set(LANGUAGE_KEY, 'FR'); expect(render()).toContain('Save workflow'); });
  it('keeps the real authored workflow and restoration epoch when language changes', () => {
    render();
    const saved = validateSavedWorkflow(editorReducer(initialEditor(), { type: 'ADD_TESTNET_SWAP', direction: 'USDC_TO_WETH', amount: '2', slippage: '50', source: 'CANVAS', baseRevision: 0 }, context).workflow);
    workflow.restoreWorkflow(saved); render();
    const before = workflow.state.workflow, epoch = workflow.restorationEpoch;
    locale.setLanguage('PT'); render(); locale.setLanguage('EN'); render();
    expect(workflow.state.workflow).toBe(before); expect(workflow.state.workflow).toEqual(saved);
    expect(workflow.restorationEpoch).toBe(epoch);
  });
  it.each(['Your workflows are temporarily unavailable.', 'Showing up to 100 workflows.', 'Workflow saved.', 'Workflow restored. Simulate again before reviewing.', 'This workflow was updated in another session. Reopen it before saving.'])('uses the catalog for normal saved-workflow copy: %s', message => {
    expect(portuguese[message]).toBeDefined(); expect(translate('PT', message)).toBe(portuguese[message]); expect(translate('EN', message)).toBe(message);
  });
  it('renders saved-workflow empty/error/pagination messages through the PT catalog', () => {
    const html = host.render(() => renderToStaticMarkup(<LocaleProvider initialLanguage="PT"><YourWorkflows list={{ items: [], hasMore: true }} busy={false} error="WORKFLOW_UNAVAILABLE" open={vi.fn()} refresh={vi.fn()}/></LocaleProvider>));
    for (const message of ['Your workflows are temporarily unavailable.', 'Showing up to 100 workflows.']) expect(html).toContain(portuguese[message]);
    const empty = host.render(() => renderToStaticMarkup(<LocaleProvider initialLanguage="PT"><YourWorkflows list={{ items: [], hasMore: false }}/></LocaleProvider>));
    expect(empty).toContain(portuguese['No workflows yet.']);
    expect(html).not.toContain('Workflows are temporarily unavailable');
  });
  it('preserves user names, addresses and template values', () => {
    expect(translate('PT', 'My workflow 0x1234')).toBe('My workflow 0x1234');
    expect(translate('PT', '  Save workflow  ')).toBe('  Guardar fluxo  ');
  });
});
