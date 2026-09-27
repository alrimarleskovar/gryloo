// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-003D reference executor: journal, attempts and recovery decisions (filled in phase P3). */
export const REFERENCE_EXECUTOR_PACKAGE = '@defi-workflow-engine/reference-executor';
export { createJournal, appendJournalState } from './journal.js';
export { prepareAttemptState, transitionAttemptState } from './attempts.js';
export { classifyUnknownResult, decideRetry } from './recovery.js';
export { writeExtendingFile, readValidatedFile } from './file-store.js';
export { createAttemptCoordinator } from './attempts.js';
export type { Attempt, AttemptPreparation, AttemptStore } from './attempts.js';
export { createModeBWorker, signModeBLocalTransaction } from './mode-b.js';
export type { ModeBWorkerJob, ModeBDriver, ModeBWorkerEvent } from './mode-b.js';

export { initialCowRecord, transitionCow, cowStatus, postCowOnce, recoverCowPost, signCowDisposable } from './cow.js';
export type { CowOrderState, CowOrderbookStatus, CowOrderbookView, CowSignedOrder, CowOrderbookTransport, CowPostingRecord } from './cow.js';
