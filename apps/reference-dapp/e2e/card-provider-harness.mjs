// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Explicit MOCKED loopback stand-in for Mercado Pago's documented Customers/Cards API (`/v1/customers`, `/v1/customers/search`,
 * `/v1/customers/{id}/cards`). No public transport, no real card, never provider evidence. The browser-side SDK stand-in
 * (`card-provider-fixtures.ts`) encodes only the last four digits, expiry and brand in its fake token, playing the part of
 * Mercado Pago's own tokenization. Every request FloFi's server makes is logged so tests can prove what reached the provider.
 */
import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';

const ACCESS_TOKEN = 'Bearer TEST-flofi-loopback-harness-server-only';
let state = { customers: new Map(), cards: new Map(), log: [], nextCard: 8987269650 };
const reply = (res, status, value) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
const decodeToken = token => {
  const match = /^harness_([A-Za-z0-9_-]+)$/.exec(token ?? '');
  if (!match) return null;
  try { return JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')); } catch { return null; }
};

if (process.argv.includes('--serve')) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1:8555');
      let body = '';
      for await (const chunk of req) { body += chunk.toString(); if (Buffer.byteLength(body) > 65_536) throw new Error('MOCK_INPUT_TOO_LARGE'); }
      if (url.pathname === '/__harness/health') { reply(res, 200, { harness: 'MOCKED Mercado Pago Customers/Cards' }); return; }
      if (url.pathname === '/__harness/requests') { reply(res, 200, state.log); return; }
      if (url.pathname === '/__harness/reset') { state = { customers: new Map(), cards: new Map(), log: [], nextCard: 8987269650 }; reply(res, 200, { ok: true }); return; }
      state.log.push({ method: req.method, path: `${url.pathname}${url.search}`, authorization: req.headers.authorization === ACCESS_TOKEN ? 'server-token' : 'other', body });
      if (req.headers.authorization !== ACCESS_TOKEN) { reply(res, 401, { message: 'unauthorized' }); return; }
      const value = body ? JSON.parse(body) : null;
      if (req.method === 'POST' && url.pathname === '/v1/customers') {
        if ([...state.customers.values()].some(customer => customer.email === value?.email))
          { reply(res, 400, { message: 'the customer already exist.', cause: [{ code: '101', description: 'the customer already exist.' }] }); return; }
        const customer = { id: `47018334${state.customers.size}-harnessCustomer`, email: value?.email };
        state.customers.set(customer.id, customer); reply(res, 201, customer); return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/customers/search') {
        reply(res, 200, { paging: { total: 1 }, results: [...state.customers.values()].filter(customer => customer.email === url.searchParams.get('email')) }); return;
      }
      const cards = /^\/v1\/customers\/([^/]+)\/cards(?:\/([0-9]+))?$/.exec(url.pathname);
      if (cards && state.customers.has(cards[1])) {
        const customerId = cards[1];
        if (req.method === 'POST' && !cards[2]) {
          const token = decodeToken(value?.token);
          if (!token) { reply(res, 400, { message: 'invalid token', cause: [{ code: '121', description: 'the card is invalid.' }] }); return; }
          const card = { id: String(state.nextCard++), expiration_month: token.m, expiration_year: token.y, first_six_digits: token.b, last_four_digits: token.l,
            payment_method: { id: token.t, name: token.t, payment_type_id: 'credit_card', thumbnail: 'http://img.mlstatic.com/org-img/MP3/API/logos/visa.gif',
              secure_thumbnail: 'https://www.mercadopago.com/org-img/MP3/API/logos/visa.gif' },
            security_code: { length: 3, card_location: 'back' }, issuer: { id: 25, name: token.t },
            cardholder: { name: 'APRO', identification: { number: '12345678909', type: 'CPF' } },
            date_created: '2026-10-08T01:00:00.000-04:00', date_last_updated: '2026-10-08T01:00:00.000-04:00', customer_id: customerId, user_id: '470183340', live_mode: false,
            // A misbehaving provider response for the fail-closed test: it echoes a full card number.
            ...token.e ? { card_number: token.e } : {} };
          state.cards.set(`${customerId}/${card.id}`, card); reply(res, 200, card); return;
        }
        if (req.method === 'GET' && !cards[2]) { reply(res, 200, [...state.cards.entries()].filter(([key]) => key.startsWith(`${customerId}/`)).map(([, card]) => card)); return; }
        if (req.method === 'DELETE' && cards[2]) {
          const card = state.cards.get(`${customerId}/${cards[2]}`);
          if (!card) { reply(res, 404, { message: 'not_found' }); return; }
          state.cards.delete(`${customerId}/${cards[2]}`); reply(res, 200, card); return;
        }
      }
      reply(res, 404, { message: 'not_found' });
    } catch { reply(res, 400, { error: 'MOCK_HARNESS_DENIED' }); }
  });
  server.listen(8555, '127.0.0.1');
}
