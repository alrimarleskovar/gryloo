# Working in this repository

This file tells coding agents how to work on Gryloo. It adds no authority of its own.

## Authority hierarchy

Follow the hierarchy in [Master Prompt §0](prompts/DEFI_WORKFLOW_ENGINE_MASTER_PROMPT_ASTRA_v1.2_EN.md), from highest to lowest:

1. Explicit and current instructions from the human product owner.
2. [`docs/specs/MASTER_SPEC_V3.2.md`](docs/specs/MASTER_SPEC_V3.2.md).
3. The Master Prompt.
4. Approved ADRs in [`docs/adr/`](docs/adr/).
5. The current approved build plan in [`docs/builds/`](docs/builds/).
6. Existing code and documentation.
7. Your own suggestions.

Approval exists only when it is recorded in [`docs/DECISIONS.md`](docs/DECISIONS.md) and the build plan. An uncommitted working-tree edit, a chat summary or an earlier session's statement is not a record.

## Conflict protocol

When two sources conflict, or when the work would leave the approved path set, authority or evidence ceiling:

- do not choose silently;
- stop the affected work;
- describe the conflict objectively;
- recommend the narrowest and safest interpretation;
- wait for the owner.

Unaffected work may continue. Record the owner's answer as a plan amendment and a decision row before relying on it.

## Build discipline

- Current build status is in [`docs/STATUS.md`](docs/STATUS.md) and [`docs/NEXT_BUILD.md`](docs/NEXT_BUILD.md).
- Change only the exact Create and Modify paths in the approved plan's §8. Every other tracked path is byte- and mode-protected; the governance workflow enforces this.
- Never modify the Master Spec, the Master Prompt, accepted ADRs, frozen v1 schemas and fixtures, historical plans and reports, or the certified BUILD-003F transcript.
- Report results faithfully:
  - a skipped test is not a pass;
  - a test run under a substitute configuration is not the real result;
  - a snapshot written with `--update-snapshots` is not verification.
- Never claim a merge, remote CI, owner wallet acceptance, certification or an evidence level that has not happened. Local evidence is capped at `FORK_REPRODUCED` on chain 31337.

## Secrets and network

- Never request, print or commit a phrase, private key or provider credential.
- Disposable local keys live only in mode-0600 files under `/tmp`, outside Git.
- Fork and browser acceptance runs offline. Run them inside a network namespace, for example `unshare -rn --pid --fork --mount-proc`, with loopback only.
- The replay upstream serves only the certified transcript. It never synthesizes an answer.

## Toolchain

- Node 24.21.0, pnpm 11.22.0 and Foundry Anvil 1.8.3, exactly as pinned.
- `pnpm check` runs typecheck, lint, build, the schema check and the unit tests.
- Local-fork tests are opt-in and need a fork profile. BUILD-004 plan Amendment A-1 documents how to run the Mode B fork, browser and fork-test commands.
