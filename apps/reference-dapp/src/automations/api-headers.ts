// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: the server-to-server header of automation approval calls (BFF → Railway API): the wallets the browser proved,
 * as `namespace:address` joined by commas (at most one per namespace). Set only by the BFF from the HttpOnly session cookies; the
 * browser never reaches the API, so it can never set it. (Owner operations use the saved-workflow owner header.)
 */
export const APPROVAL_PRINCIPALS_HEADER = 'x-flofi-wallet-principals';
