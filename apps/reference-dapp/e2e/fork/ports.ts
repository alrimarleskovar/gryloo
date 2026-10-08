// SPDX-License-Identifier: AGPL-3.0-only
/** Configurable loopback ports keep concurrent worktrees' synthetic chains separate. */
const fork = Number(process.env.FLOFI_E2E_FORK_PORT ?? '8545');
if (!Number.isSafeInteger(fork) || fork < 1024 || fork > 65533) throw Error('E2E_FORK_PORT_INVALID');
export const E2E_PORTS = Object.freeze({ fork, source: fork + 1, health: fork + 2 });
export const E2E_FORK_URL = `http://127.0.0.1:${fork}`;
