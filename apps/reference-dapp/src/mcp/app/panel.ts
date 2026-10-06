// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: the in-chat FloFi approval panel, an MCP App (`io.modelcontextprotocol/ui`, spec 2026-01-26) attached to
 * `request_user_approval`. The host renders it in a sandboxed iframe and sends it the tool result. It shows the external
 * proposal (network, funds class, steps, workflow hash, authority NONE) and offers ways to reach the owner's own wallet:
 *
 *   B. FloFi signing window (desktop default)  app-only `open_approval_session` → `ui/open-link` to a fresh FloFi URL
 *   C. Wallet in-app browsers (mobile)          the same URL inside Phantom / MetaMask, whose browsers inject their own provider
 *   E. /approve link (universal fallback)       always shown as text, also in the tool result for hosts without MCP Apps
 *   A. In-frame wallet                          NOT an execution path: an environment probe only (is a wallet injected here? may
 *                                               this frame open popups?) reported for the owner's host experiments; off unless the
 *                                               host is listed in FLOFI_MCP_INFRAME_WALLET_HOSTS, and even then it only reports
 *   D. WalletConnect / Reown                    deferred; the adapter list has room for it
 *
 * Then it polls the app-only `get_execution_progress` and, when a run is reconciled, puts its status and evidence summary into the
 * model's context (`ui/update-model-context`). The panel has no network access of its own (empty CSP domains): every call goes
 * through the host to FloFi's MCP server with the user's OAuth token. It never sees a key, never signs and never sends.
 */
export const PANEL_URI = 'ui://flofi/approval-panel.html';
export const PANEL_MIME = 'text/html;profile=mcp-app';
export type PanelSettings = { readonly origin: string; readonly inFrameProbeHosts: readonly string[] };

/**
 * The panel's browser program. It is serialized with `Function.prototype.toString`, so it must stay self-contained: no imports,
 * no closure over module scope, only browser globals. Strings from the server are rendered with `textContent`, never as HTML.
 */
export function panelMain(settings: PanelSettings): void {
  type Json = Record<string, unknown>;
  type Step = { index: number; action: string; network: string; destinationNetwork: string | null; protocol: string; kind: string };
  type Approval = { approvalId: string; approvalUrl?: string; workflowHash: string; expiresAt: string; status: string; networkEnvironment: string; fundsClass: string;
    steps: Step[]; authority: string; requires?: string[]; summary?: string; walletNamespace?: string };
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const view: { approval: Approval | null; progress: Json | null; error: string | null; host: string; opened: string | null; probe: Json | null; reported: string } =
    { approval: null, progress: null, error: null, host: '', opened: null, probe: null, reported: '' };
  let nextId = 1, timer: ReturnType<typeof setTimeout> | null = null, polls = 0;
  const post = (message: Json) => window.parent.postMessage({ jsonrpc: '2.0', ...message }, '*');
  const request = (method: string, params: Json) => new Promise<unknown>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    post({ id, method, params });
    setTimeout(() => { if (pending.delete(id)) reject(new Error('HOST_TIMEOUT')); }, 30_000);
  });
  const callTool = async (name: string, args: Json): Promise<Json> => {
    const result = await request('tools/call', { name, arguments: args }) as { structuredContent?: Json; isError?: boolean };
    const content = result?.structuredContent ?? {};
    if (result?.isError || content.ok === false) throw new Error(typeof content.code === 'string' ? content.code : 'TOOL_FAILED');
    return content;
  };
  const el = (tag: string, text?: string, className?: string) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (label: string, onClick: () => void, primary = false) => {
    const node = el('button', label, primary ? 'primary' : 'secondary') as HTMLButtonElement;
    node.type = 'button'; node.addEventListener('click', onClick);
    return node;
  };
  const isApproval = (value: unknown): value is Approval => !!value && typeof value === 'object' && typeof (value as Json).approvalId === 'string' &&
    /^apr_[a-z2-7]{26}$/.test(String((value as Json).approvalId)) && Array.isArray((value as Json).steps);
  const terminal = (status: unknown) => ['EXPIRED', 'SUPERSEDED', 'REVOKED', 'STALE'].includes(String(status));

  /** Opens a FloFi URL through the host (MCP Apps `ui/open-link`; ChatGPT's `openExternal` when the standard call is refused). */
  async function openLink(url: string) {
    try { await request('ui/open-link', { url }); return; }
    catch {
      const openai = (window as unknown as { openai?: { openExternal?: (input: { href: string }) => unknown } }).openai;
      if (openai?.openExternal) { await openai.openExternal({ href: url }); return; }
      throw new Error('OPEN_LINK_REFUSED');
    }
  }
  async function connect(target: 'window' | 'phantom' | 'metamask') {
    if (!view.approval) return;
    view.error = null;
    try {
      const session = await callTool('open_approval_session', { approvalId: view.approval.approvalId });
      const links = (session.walletLinks ?? {}) as Record<string, string>;
      const url = target === 'window' ? String(session.approvalUrl) : links[target];
      if (!url || !url.startsWith('https://') && !url.startsWith(settings.origin)) throw new Error('APPROVAL_LINK_INVALID');
      await openLink(url);
      view.opened = target;
      schedule(2_000);
    } catch (error) { view.error = error instanceof Error ? error.message : 'OPEN_FAILED'; }
    render();
  }
  /** Adapter A: report what this frame can do; never request accounts, never sign. */
  function probe() {
    const w = window as unknown as { ethereum?: unknown; solana?: unknown; phantom?: unknown };
    let standardWallets = 0;
    try {
      window.addEventListener('wallet-standard:register-wallet', () => { standardWallets++; }, { once: false });
      window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: { register: () => { standardWallets++; return () => undefined; } } }));
    } catch { /* events may be blocked */ }
    let popups: string;
    try { const opened = window.open('about:blank', '_blank', 'noopener'); popups = opened === null ? 'BLOCKED_OR_NOOPENER' : 'ALLOWED'; } catch { popups = 'BLOCKED'; }
    view.probe = { host: view.host || 'unknown', injectedEvm: typeof w.ethereum === 'object' && w.ethereum !== null, injectedSolanaLegacy: !!(w.solana || w.phantom),
      walletStandard: standardWallets, popups, origin: location.origin, checkedAt: new Date().toISOString(),
      note: 'Diagnostics only: in-frame execution is not enabled; use the FloFi window.' };
    render();
  }
  function schedule(delay: number) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void poll(); }, delay);
  }
  async function poll() {
    if (!view.approval || polls++ > 360) return;
    try {
      view.progress = await callTool('get_execution_progress', { approvalId: view.approval.approvalId });
      view.error = null;
      report();
    } catch (error) { view.error = error instanceof Error ? error.message : 'PROGRESS_FAILED'; }
    render();
    const runs = Array.isArray(view.progress?.runs) ? view.progress!.runs as Json[] : [];
    const done = terminal(view.progress?.status) || runs.length > 0 && runs.every(r => r.reconciled === true || r.terminal === true);
    if (!done) schedule(view.opened ? 5_000 : 15_000);
  }
  /** Status and evidence back to the conversation: public facts only (ids, states, environment, bundle hash). */
  function report() {
    const progress = view.progress;
    if (!progress) return;
    const runs = Array.isArray(progress.runs) ? progress.runs as Json[] : [];
    const summary = JSON.stringify({ status: progress.status, runs: runs.map(r => [r.executionId, r.status, r.evidenceEnvironment ?? null, r.evidenceBundleHash ?? null]) });
    if (summary === view.reported) return;
    view.reported = summary;
    const lines = [`FloFi approval ${view.approval?.approvalId}: ${String(progress.status)}.`, ...runs.map(r =>
      `Run ${String(r.executionId)} (${String(r.flow)}): ${String(r.status)}${r.evidenceEnvironment ? `, evidence ${String(r.evidenceEnvironment)} ${String(r.evidenceBundleHash ?? '')}` : ''}.`)];
    void request('ui/update-model-context', { content: [{ type: 'text', text: lines.join(' ') }],
      structuredContent: { flofiApproval: { approvalId: view.approval?.approvalId, status: progress.status, runs } } }).catch(() => undefined);
  }

  function render() {
    const root = document.getElementById('app')!;
    root.replaceChildren();
    const a = view.approval;
    if (!a) { root.append(el('p', view.error ? `FloFi could not prepare this approval (${view.error}).` : 'Waiting for the FloFi approval…', 'muted')); return; }
    const status = String(view.progress?.status ?? a.status);
    const head = el('div', undefined, 'head');
    head.append(el('span', 'FLOFI · EXTERNAL PROPOSAL', 'eyebrow'), el('span', status, 'badge'));
    root.append(head, el('h1', a.summary ?? 'Strategy ready for your approval'));
    root.append(el('p', 'Nothing is authorized yet. Only your own wallet can sign, after a fresh simulation and the Strategy Manifest Review in FloFi.', 'notice'));
    if (a.fundsClass === 'REAL_FUNDS') root.append(el('p', 'Real funds: this strategy uses a mainnet.', 'warning'));
    const facts = el('dl');
    const fact = (label: string, value: string) => { facts.append(el('dt', label), el('dd', value)); };
    fact('Network', `${a.networkEnvironment === 'MAINNET' ? 'Mainnet' : 'Public testnet'} · ${[...new Set(a.steps.flatMap(s => [s.network, s.destinationNetwork].filter(Boolean) as string[]))].join(' → ')}`);
    fact('Funds', a.fundsClass === 'REAL_FUNDS' ? 'Real funds' : 'Test funds');
    fact('Steps', a.steps.map(s => `${s.index + 1}. ${s.action} (${s.protocol || s.kind})`).join('  '));
    fact('Workflow hash', a.workflowHash);
    fact('Authority', a.authority);
    root.append(facts);
    const runs = Array.isArray(view.progress?.runs) ? view.progress!.runs as Json[] : [];
    if (runs.length) {
      const list = el('ul', undefined, 'runs');
      for (const r of runs) list.append(el('li', `${String(r.flow)} · ${String(r.status)}${r.evidenceEnvironment ? ` · evidence ${String(r.evidenceEnvironment)}` : ''}`));
      root.append(el('h2', 'Execution'), list);
    }
    if (!terminal(status) && status !== 'APPLIED') {
      const actions = el('div', undefined, 'actions');
      actions.append(button('Connect wallet & execute in FloFi', () => void connect('window'), true));
      root.append(actions);
      const mobile = el('div', undefined, 'actions');
      mobile.append(el('span', 'On your phone:', 'muted'), button('Open in Phantom', () => void connect('phantom')), button('Open in MetaMask', () => void connect('metamask')));
      root.append(mobile);
      root.append(el('p', 'Wallet in this chat window: not used. FloFi opens its own page so your wallet extension or app can sign there.', 'muted'));
    }
    if (a.approvalUrl && !terminal(status)) {
      const fallback = el('p', 'Or open this link in a browser with your wallet: ', 'muted');
      fallback.append(el('code', a.approvalUrl));
      root.append(fallback);
    }
    if (view.opened) root.append(el('p', 'FloFi is open. Prove your wallet, run the fresh simulation, review the Strategy Manifest and sign there. This panel follows the result.', 'muted'));
    if (settings.inFrameProbeHosts.includes(view.host)) {
      root.append(button('Check this chat environment (diagnostics)', probe));
      if (view.probe) root.append(el('pre', JSON.stringify(view.probe, null, 1)));
    }
    if (view.error) root.append(el('p', view.error, 'error'));
    post({ method: 'ui/notifications/size-changed', params: { height: document.documentElement.scrollHeight } });
  }

  window.addEventListener('message', event => {
    if (event.source !== window.parent) return;
    const message = event.data as Json & { id?: number; method?: string; params?: Json; result?: unknown; error?: { message?: string } };
    if (!message || message.jsonrpc !== '2.0') return;
    if (typeof message.id === 'number' && pending.has(message.id) && !message.method) {
      const waiter = pending.get(message.id)!; pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message ?? 'HOST_ERROR')); else waiter.resolve(message.result);
      return;
    }
    if (message.method === 'ui/notifications/tool-result') {
      const content = (message.params as { structuredContent?: unknown } | undefined)?.structuredContent;
      if (isApproval(content)) { view.approval = content; view.error = null; schedule(10_000); }
      else view.error = typeof (content as Json | undefined)?.code === 'string' ? String((content as Json).code) : 'NO_APPROVAL';
      render();
    } else if (message.method === 'ui/notifications/host-context-changed') {
      const theme = (message.params as { theme?: string } | undefined)?.theme;
      if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
    } else if (typeof message.id === 'number' && message.method) {
      post({ id: message.id, error: { code: -32601, message: 'Method not found' } });
    }
  });
  render();
  void request('ui/initialize', { appInfo: { name: 'flofi-approval', version: '1.0.0' }, appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
    protocolVersion: '2026-01-26' }).then(result => {
    const r = result as { hostInfo?: { name?: string }; hostContext?: { theme?: string } } | undefined;
    view.host = String(r?.hostInfo?.name ?? '');
    if (r?.hostContext?.theme === 'dark' || r?.hostContext?.theme === 'light') document.documentElement.dataset.theme = r.hostContext.theme;
    post({ method: 'ui/notifications/initialized', params: {} });
    render();
  }).catch(() => { view.error = 'HOST_NOT_MCP_APPS'; render(); });
}

const STYLE = `:root{color-scheme:light dark;--bg:#ffffff;--ink:#14233a;--muted:#52627a;--line:#dce4ef;--soft:#f4f7fb;--blue:#1d5fca;--amber:#915e08;--amber-soft:#fff5de;--red:#a11c29}
:root[data-theme=dark]{--bg:#0f141b;--ink:#e8edf4;--muted:#9aa8ba;--line:#2a3442;--soft:#17202b;--blue:#6ea1ff;--amber:#f2c46b;--amber-soft:#2a2110;--red:#ff8a96}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0f141b;--ink:#e8edf4;--muted:#9aa8ba;--line:#2a3442;--soft:#17202b;--blue:#6ea1ff;--amber:#f2c46b;--amber-soft:#2a2110;--red:#ff8a96}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}#app{padding:16px;display:grid;gap:10px;max-width:720px}
.head{display:flex;justify-content:space-between;align-items:center;gap:8px}.eyebrow{font-size:10px;font-weight:800;letter-spacing:.14em;color:var(--muted)}
.badge{border:1px solid var(--line);border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700}h1{font-size:17px;margin:0}h2{font-size:14px;margin:6px 0 0}
.notice{margin:0;padding:8px 10px;background:var(--soft);border-radius:8px}.warning{margin:0;padding:8px 10px;background:var(--amber-soft);color:var(--amber);border-radius:8px;font-weight:700}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:0}dt{color:var(--muted);font-size:12px}dd{margin:0;overflow-wrap:anywhere;font-size:13px}
.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}button{min-height:40px;border-radius:8px;padding:0 14px;font:inherit;font-weight:700;cursor:pointer}
button.primary{background:var(--blue);color:#fff;border:0}button.secondary{background:var(--soft);color:var(--ink);border:1px solid var(--line)}
.muted{color:var(--muted);font-size:12px;margin:0}code{font-size:11px;overflow-wrap:anywhere}pre{font-size:11px;background:var(--soft);padding:8px;border-radius:8px;overflow:auto}
.error{color:var(--red);margin:0;font-weight:700}.runs{margin:0;padding-left:18px}`;

/** The panel document: one HTML file with inline style and script, no external resource. */
export function panelHtml(settings: PanelSettings): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>FloFi approval</title><style>${STYLE}</style></head><body><main id="app" aria-live="polite"></main>` +
    `<script>(${panelMain.toString()})(${JSON.stringify(settings).replace(/</g, '\\u003c')});</script></body></html>`;
}
/** MCP Apps resource metadata: no network, no frames, no external resources; ChatGPT's mirror allows opening FloFi links only. */
export function panelResourceMeta(origin: string) {
  return { ui: { csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] }, prefersBorder: true },
    'openai/widgetCSP': { connect_domains: [], resource_domains: [], redirect_domains: [origin, 'https://phantom.app', 'https://metamask.app.link'] },
    'openai/widgetDescription': 'FloFi approval: shows the proposal and opens FloFi so the user can review and sign with their own wallet. It never signs.',
    'openai/widgetPrefersBorder': true };
}
