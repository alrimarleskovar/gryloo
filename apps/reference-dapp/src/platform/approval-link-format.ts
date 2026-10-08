// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the grammar of FloFi approval-link secrets, shared by the server and the `/approve` page (no Node imports, so
 * the browser bundle can use it). A secret is `flofi_` + a short surface tag + `hs_` + 256 random bits in base64url (43 characters):
 * MCP's BUILD-MCP-002 links are `flofi_hs_…` (empty tag); a later surface registers its own tag (e.g. `flofi_dhs_`). The grammar never
 * matches OAuth tokens or codes (`flofi_at_`, `flofi_rt_`, `flofi_code_`, `flofi_csrf_`).
 */
export const APPROVAL_SECRET_FORMAT = /^flofi_[a-z]{0,6}hs_[A-Za-z0-9_-]{43}$/;
/** The prefix of one approval-link scheme: `flofi_` + tag + `hs_`. */
export const APPROVAL_SCHEME_PREFIX = /^flofi_[a-z]{0,6}hs_$/;
