// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: the OAuth consent and error pages. Plain server-rendered HTML with no script, every interpolated value
 * HTML-escaped, a strict Content-Security-Policy (no framing, no script, forms only to FloFi and the client's own redirect
 * origin), `no-store`, `noindex` and a `same-origin` referrer policy: no referrer ever reaches another origin, while FloFi's own
 * consent form still carries its real `Origin` (a `no-referrer` page makes browsers send `Origin: null` on form posts, which the
 * decision endpoint must refuse). The page states what a connection can and cannot do: it never connects a wallet and never
 * authorizes a transaction.
 */
import type { McpScope } from './config.ts';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const escapeHtml = (value: string) => value.replace(/[&<>"'`]/g, c => ESCAPES[c]!);

export const SCOPE_TEXT: Readonly<Record<McpScope, string>> = Object.freeze({
  'flofi.strategy': 'Compose, check, review and preview (simulate) strategies with FloFi\'s engine.',
  'flofi.approval': 'Prepare approval requests that you open, review and sign yourself in FloFi.',
  'flofi.runs': 'Read the status and evidence of runs made by wallets you link to this account on FloFi.',
});

const STYLE = `body{font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;margin:0;background:#f6f7f9;color:#14171a}
main{max-width:560px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 12px}section{background:#fff;border:1px solid #dde1e6;border-radius:12px;padding:16px;margin:12px 0}
.warn{border-color:#d97706;background:#fffbeb}.muted{color:#5b6470;font-size:14px}ul{padding-left:20px}code{font-size:13px;word-break:break-all}
label{display:block;font-weight:600;margin:8px 0 4px}input[type=text]{width:100%;box-sizing:border-box;padding:10px;border:1px solid #b9c0c8;border-radius:8px;font-size:16px}
.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:16px}button{flex:1;min-width:140px;padding:12px;border-radius:8px;border:1px solid #14171a;font-size:16px;cursor:pointer}
.approve{background:#14171a;color:#fff}.deny{background:#fff;color:#14171a}
@media (prefers-color-scheme:dark){body{background:#0f1215;color:#e8eaed}section{background:#171b20;border-color:#2b3138}.warn{background:#2a2113;border-color:#b45309}
.muted{color:#9aa3ad}input[type=text]{background:#0f1215;color:#e8eaed;border-color:#3a414a}button{border-color:#e8eaed}.approve{background:#e8eaed;color:#0f1215}.deny{background:#171b20;color:#e8eaed}}`;

export function pageHeaders(formOrigins: readonly string[]): Record<string, string> {
  const forms = ["'self'", ...formOrigins].join(' ');
  return { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', pragma: 'no-cache', 'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY', 'referrer-policy': 'same-origin', 'x-robots-tag': 'noindex, nofollow',
    'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; form-action ${forms}; frame-ancestors 'none'; base-uri 'none'` };
}
const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="same-origin"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><main>${body}</main></body></html>`;

export type ConsentView = {
  readonly requestId: string; readonly csrf: string; readonly clientName: string; readonly clientId: string; readonly redirectUri: string;
  readonly scopes: readonly McpScope[]; readonly account: { readonly existing: string } | { readonly create: true; readonly inviteRequired: boolean };
  readonly error?: string;
};
/** The consent page. The redirect hostname is always shown; a loopback-only client gets an explicit warning. */
export function consentPage(view: ConsentView): string {
  const redirect = new URL(view.redirectUri), loopback = ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname);
  const account = 'existing' in view.account
    ? `<p>You are signed in to FloFi as <code>${escapeHtml(view.account.existing)}</code> (a pseudonymous account; it has no wallet attached).</p>`
    : `<p>A new pseudonymous FloFi account will be created for this connection. It has no name, no email and no wallet.</p>` +
      (view.account.inviteRequired ? `<label for="invite">Invite code</label><input id="invite" name="invite" type="text" autocomplete="off" required maxlength="128">` : '');
  return page('Connect to FloFi', `<h1>Connect ${escapeHtml(view.clientName)} to FloFi</h1>
<section><p><strong>${escapeHtml(view.clientName)}</strong> asks to use FloFi on your behalf.</p>
<p class="muted">Client: <code>${escapeHtml(view.clientId)}</code><br>After you decide, you return to <strong>${escapeHtml(redirect.host)}</strong>.</p>
${loopback ? '<p class="muted"><strong>This client returns to an app on your own computer (localhost).</strong> Continue only if you started this connection yourself.</p>' : ''}
<p>It will be able to:</p><ul>${view.scopes.map(s => `<li>${escapeHtml(SCOPE_TEXT[s])}</li>`).join('')}</ul></section>
<section class="warn"><p><strong>This connection never moves funds.</strong> It does not connect a wallet and cannot sign, approve or send any transaction.
Every execution needs you to open FloFi, prove your wallet, review a fresh simulation and the Strategy Manifest, and sign with your own wallet.</p>
<p class="muted">Strategies proposed in a chat are produced with an AI assistant. They are not financial advice; you decide.</p></section>
<form method="post" action="/oauth/authorize"><section>${account}
${view.error ? `<p role="alert"><strong>${escapeHtml(view.error)}</strong></p>` : ''}
<input type="hidden" name="request_id" value="${escapeHtml(view.requestId)}"><input type="hidden" name="csrf" value="${escapeHtml(view.csrf)}">
<div class="actions"><button class="approve" type="submit" name="decision" value="approve">Allow</button>
<button class="deny" type="submit" name="decision" value="deny" formnovalidate>Deny</button></div></section></form>
<p class="muted">You can disconnect at any time from the client or on FloFi.</p>`);
}

/** An error page for requests that must not be redirected (unknown client, unregistered redirect, expired request). */
export function errorPage(title: string, message: string): string {
  return page(title, `<h1>${escapeHtml(title)}</h1><section><p>${escapeHtml(message)}</p></section>`);
}
