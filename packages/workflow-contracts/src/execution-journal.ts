import { Type, type Static } from '@sinclair/typebox';
import {
  artifactObject, strictObject, list, IdentifierSchema, HashSchema,
  SafeIntegerSchema, TimestampSchema, RuntimeStateSchema,
} from './common.js';

export const JournalEntrySchema = strictObject({
  schemaVersion: Type.Literal('1.0.0'),
  entryId: IdentifierSchema,
  sequence: SafeIntegerSchema,
  previousEntryHash: Type.Union([HashSchema, Type.Null()]),
  recordedAt: TimestampSchema,
  eventType: Type.Literal('STATE_TRANSITION'),
  level: Type.Union([
    Type.Literal('workflow'),
    Type.Literal('segment'),
    Type.Literal('step'),
    Type.Literal('attempt'),
  ]),
  entityId: IdentifierSchema,
  workflowId: IdentifierSchema,
  segmentId: Type.Union([IdentifierSchema, Type.Null()]),
  stepId: Type.Union([IdentifierSchema, Type.Null()]),
  executionAttemptId: Type.Union([IdentifierSchema, Type.Null()]),
  fromState: Type.Union([RuntimeStateSchema, Type.Null()]),
  toState: RuntimeStateSchema,
});

export const ExecutionJournalSchema = artifactObject('execution-journal', {
  journalId: IdentifierSchema,
  workflowId: IdentifierSchema,
  executionPlanHash: HashSchema,
  manifestHash: HashSchema,
  entries: list(JournalEntrySchema, 16384),
});
export type ExecutionJournal = Static<typeof ExecutionJournalSchema>;
export type JournalEntry = Static<typeof JournalEntrySchema>;
