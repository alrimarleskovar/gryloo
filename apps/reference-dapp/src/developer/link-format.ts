// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the prefix of developer approval links, without imports so the `/approve` page can use it in the browser.
 * The server's link scheme (`approval-profile.ts`) is built from this same constant. The page only uses it to word its messages for
 * a link a third-party app sent; the prefix authorizes nothing, and the server alone resolves a link.
 */
export const DEVELOPER_LINK_PREFIX = 'flofi_dhs_';
