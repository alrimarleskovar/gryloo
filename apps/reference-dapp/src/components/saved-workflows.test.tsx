// SPDX-License-Identifier: AGPL-3.0-only
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { YourWorkflows } from './saved-workflows';
import { LocaleProvider } from '../i18n/locale';
import { NavigationDrawer } from './navigation-drawer';
import { SecondaryProductWorkspace } from './secondary-product-workspace';
import { secondaryWorkspaceRoute } from '../domain/secondary-workspaces';
import type { OwnerWorkflow, WorkflowList } from '../domain/saved-workflow';
const row: OwnerWorkflow = { workflowId: 'canonical-saved-id', name: 'My saved name', saved: true, version: 1, updatedAt: '2026-10-08T12:00:00Z', runCount: 0, lastRunId: null, lastStatus: null, hasEvidence: false };
const render = (list: WorkflowList) => renderToStaticMarkup(<YourWorkflows list={list} busy={false} error={null} open={vi.fn()} refresh={vi.fn()}/>);
describe('Your workflows secondary workspace presentation', () => {
  it('shows a saved workflow by its user name without run details or identifiers', () => {
    const html = render({ items: [row], hasMore: false }); expect(html).toContain('Your workflows'); expect(html).toContain('My saved name');
    for (const value of ['Never executed', 'canonical-saved-id', 'View run', 'Connect Wallet']) expect(html).not.toContain(value);
  });
  it('shows one identity for saved and executed workflows with multiple associated runs', () => {
    const html = render({ items: [{ ...row, runCount: 3, lastRunId: 'latest-run', lastStatus: 'RECONCILED', hasEvidence: true }], hasMore: false });
    expect(html.match(/My saved name/g)).toHaveLength(1);
    for (const value of ['RECONCILED', 'latest-run', 'View run', 'Evidence available']) expect(html).not.toContain(value);
  });
  it('shows an executed-only identity without inventing a saved name', () => {
    const html = render({ items: [{ ...row, name: null, saved: false, version: null, runCount: 1, lastRunId: 'historical-run', lastStatus: 'RECONCILED' }], hasMore: false });
    expect(html).toContain('<span>Workflow</span>'); expect(html).not.toContain('historical-run'); expect(html).not.toContain('My saved name');
  });
  it.each([['EN', 'Your workflows'], ['PT', 'Seus workflows']] as const)('has only a navigation entry in %s and renders the library in its workspace', (language, label) => {
    const html = renderToStaticMarkup(<LocaleProvider initialLanguage={language}><NavigationDrawer pathname="/app/workflows" onBuild={vi.fn()} onDisconnect={vi.fn()} disconnectDisabled/></LocaleProvider>);
    expect(html).toContain('href="/app/workflows"'); expect(html).toContain(`aria-current="page"`); expect(html).toContain(`<span>${label}</span>`);
    for (const value of ['navigation-workflows', 'My saved name', 'Refresh', 'Loading', 'temporarily unavailable', 'No workflows yet']) expect(html).not.toContain(value);
    const workspace = renderToStaticMarkup(<LocaleProvider initialLanguage={language}><SecondaryProductWorkspace workspace="workflows" workflows={{ list: { items: [{ ...row, name: 'Save workflow' }], hasMore: false }, busy: false, error: null, open: vi.fn(), refresh: vi.fn() }}/></LocaleProvider>);
    expect(workspace).toContain(`<h1>${label}</h1>`); expect(workspace).toContain('<span>Save workflow</span>'); expect(workspace).not.toContain('navigation-drawer');
    expect(secondaryWorkspaceRoute('/app/workflows/')?.id).toBe('workflows');
  });
  it('puts loading, retry and empty states in the workspace', () => {
    expect(render({ items: [], hasMore: false })).toContain('Build or execute a workflow and it will appear here.');
    expect(renderToStaticMarkup(<YourWorkflows loading/>)).toContain('Loading your workflows…');
    const error = renderToStaticMarkup(<YourWorkflows error="WORKFLOW_UNAVAILABLE" refresh={vi.fn()}/>);
    expect(error).toContain('Your workflows are temporarily unavailable.'); expect(error).toContain('Retry');
    expect(renderToStaticMarkup(<YourWorkflows connected={false}/>)).toContain('Connect a wallet from the header');
  });
});
