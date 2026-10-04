# ADR-0006 — Flofi product brand, preserved Gryloo compatibility

Date: 2026-10-02. Status: accepted under the owner's BUILD-BRAND-001 request.

The active product is now Flofi, formerly Gryloo. Apply the name to current UI
and repository presentation and to the living master specification/prompt.
This is a branding-only amendment; the product thesis and technical contracts
are unchanged. Existing ADRs and historical evidence retain their original text.

Keep `GRYLOO_*` configuration, `~/.gryloo` runtime paths, persisted `gryloo.*`
identifiers, package namespaces and provider identities compatible. No schema
migration or environment alias is needed for the display rename. Preserve all
execution, authorization, recovery, reconciliation and evidence semantics.

See the [build plan](../builds/BUILD-BRAND-001-PLAN.md) for identifier classification,
validation, non-goals, and the owner-only repository/deployment rename handoffs.
