# Scope guard

## Immutable product thesis

- Gryloo is a conversational and visual compiler plus bounded executor, not a
  swap chatbot or unrestricted autonomous agent.
- Chat, canvas, and integrations share one Semantic Workflow IR.
- Semantic intent, observations, simulation, authorization, execution, journal,
  and evidence remain distinct.
- AI may propose and explain; it is never financial authority.
- Authorization limits must be technically enforced at the stated boundary.
- Execution is fail-closed, resumable, idempotent, and honestly reconciled.

## Naming and visual controls

The display brand is Gryloo. Persistent contracts, schemas, packages, events,
IDs, database objects, and APIs use neutral names. The visual assets are
direction only. Historical or prohibited names may appear solely in governance
checks explaining that they are prohibited. Unsupported claims of protection or
safety are forbidden unless tied to a named enforceable technical control.

## Approved BUILD-001 boundary

The human owner approved the complete revised canonical-contracts plan on
2026-09-22. Its exact create and modify lists are recorded in
[BUILD-001-PLAN.md](builds/BUILD-001-PLAN.md) and enforced by governance CI.
Only the two private contract packages, schemas, fixtures, pure validation and
hash functions, declarative registry, fixed toolchain, tests, and governance
updates are authorized. Implementation uses only
`codex/build-001-canonical-contracts` and is delivered as an unmerged pull request.

All BUILD-000 records, ADR-0001, Master Spec, Master Prompt, root legal texts,
and assets remain byte-identical. ADR-0001 remains `PROPOSED`. Package LICENSE
files must be byte-for-byte copies of `LICENSES/Apache-2.0.txt`.

## Deferred scope

BUILD-002 and all later builds require separate approval. There is no approval
for a DApp, chat, canvas, API, database, worker, wallet connection, protocol
adapter, transaction construction, signing, submission, live quote, financial
simulation, reconciliation implementation, managed-plane component, package
publication, or Mode B selection. Descriptive contracts for these concepts
grant no authority to implement or execute them.

Any difference from approved dependency versions, integrity digests, Node
checksum, peers, licenses, parser behavior, CI downloads, or transitive review
must stop implementation for a human decision before substitution.
