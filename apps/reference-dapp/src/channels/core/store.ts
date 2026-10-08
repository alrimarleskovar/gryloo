// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: Channel Core's durable state (migration 0008), behind one interface with one implementation (PostgreSQL,
 * `pg-store.ts`). It holds conversations, content-free event records and the outbox — never a raw message, a provider id in clear,
 * a wallet, an approval secret or anything that could authorize. Approval handoffs themselves live in the shared platform store.
 *
 * Concurrency: one conversation is processed by one lease holder at a time (fencing token checked on every commit); events are
 * deduplicated by their keyed digest; outbound messages are deduplicated by key, claimed once (`FOR UPDATE SKIP LOCKED`), correlated
 * by id and never sent twice (a send whose outcome is unknown becomes UNCERTAIN, not PENDING). Expiry and erasure run on every
 * authenticated delivery and on the scheduled dispatch; the database CHECKs keep content from outliving its use. Every method is
 * scoped to the store's tenant. Each state change also appends a content-free audit row in the same transaction.
 */
import type { ChannelId, ReplyKind } from './types.ts';

export type ConversationStatus = 'ACTIVE' | 'OPTED_OUT';
export type ConversationRecord = {
  readonly conversationId: string; readonly channel: ChannelId; readonly businessId: string; readonly status: ConversationStatus;
  readonly addressSealed: Buffer | null; readonly stateSealed: Buffer | null; readonly lastInboundAt: Date | null; readonly lastActivityAt: Date;
  readonly createdAt: Date;
};
export type NewEvent = { readonly channel: ChannelId; readonly eventDigest: Buffer; readonly conversationId: string | null; readonly sentAt: Date;
  readonly status: 'PENDING' | 'IGNORED'; readonly payloadSealed: Buffer | null; readonly outcome: string | null };
export type PendingEvent = { readonly channel: ChannelId; readonly eventDigest: Buffer; readonly sentAt: Date; readonly receivedAt: Date;
  readonly attempts: number; readonly payloadSealed: Buffer | null };
export type OutboxKind = ReplyKind;
export type OutboxStatus = 'PENDING' | 'SENDING' | 'SENT' | 'UNCERTAIN' | 'FAILED' | 'DEAD' | 'SKIPPED';
export type NewOutbox = { readonly outboxId: string; readonly dedupeKey: string; readonly kind: OutboxKind; readonly sequence: number;
  readonly bodySealed: Buffer; readonly handoffId: string | null };
export type OutboxRecord = NewOutbox & { readonly conversationId: string; readonly status: OutboxStatus;
  readonly attempts: number; readonly createdAt: Date; readonly delivery: string | null; readonly errorCode: string | null };
export type TurnCommit = {
  readonly channel: ChannelId; readonly eventDigest: Buffer; readonly status: 'DONE' | 'FAILED'; readonly outcome: string; readonly handoffId: string | null;
  /** New sealed state; null erases it; undefined leaves it unchanged. */
  readonly stateSealed?: Buffer | null;
  readonly conversationStatus?: ConversationStatus;
  readonly outbox: readonly NewOutbox[];
};
export type DeliveryRank = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
/** A conversation that has work, and the channel whose provider must do it. */
export type ConversationRef = { readonly conversationId: string; readonly channel: ChannelId };
/** An approval a conversation created, still followed for status notifications. */
export type WatchedHandoff = ConversationRef & { readonly handoffId: string };

export interface ChannelStore {
  /** False until migration 0008 is installed: every channel operation then fails closed. */
  readonly schemaInstalled: () => Promise<boolean>;
  /** The conversation of a sender (created on first contact); the messaging window follows the provider's send time, never delivery. */
  readonly ensureConversation: (channel: ChannelId, businessId: string, subjectDigest: Buffer, sentAt: Date, now: Date, newId: string) => Promise<ConversationRecord>;
  readonly conversation: (conversationId: string) => Promise<ConversationRecord | null>;
  /** Stores the sealed send address of an ACTIVE conversation (an opted-out one keeps none). */
  readonly storeAddress: (conversationId: string, sealed: Buffer) => Promise<void>;
  /** Inserts event records; returns the digests that were new (a duplicate delivery inserts nothing). */
  readonly recordEvents: (events: readonly NewEvent[], now: Date) => Promise<readonly Buffer[]>;
  /** Takes the conversation's lease when free or expired. */
  readonly acquire: (conversationId: string, token: string, now: Date, seconds: number) => Promise<boolean>;
  /** The oldest pending event of the conversation, counting this attempt; null when none. */
  readonly nextEvent: (conversationId: string, token: string, now: Date) => Promise<PendingEvent | null>;
  /**
   * Records one turn atomically under the lease: the event's outcome (its payload erased), the conversation's state and status, and
   * the turn's outbound messages (deduplicated by key). Returns the outbox ids actually inserted. `CHANNEL_LEASE_LOST` otherwise.
   */
  readonly completeTurn: (conversationId: string, token: string, commit: TurnCommit, now: Date) => Promise<readonly string[]>;
  /** Releases the lease only when no event is pending; false means more work arrived and the holder keeps going. */
  readonly release: (conversationId: string, token: string, now: Date) => Promise<boolean>;
  /**
   * Due outbound messages of a conversation (PENDING and due, or SENDING and stale), now marked SENDING, oldest first, limited to
   * `kinds` (an approval message is only ever claimed by the turn that holds its link in memory).
   */
  /**
   * Due outbound messages of a conversation (PENDING and due), now marked SENDING, oldest first, limited to `kinds` (an approval
   * message is only ever sent by the turn that holds its link in memory; elsewhere it is withdrawn).
   */
  readonly claimDue: (conversationId: string, now: Date, limit: number, kinds: readonly OutboxKind[]) => Promise<readonly OutboxRecord[]>;
  readonly markSent: (outboxId: string, providerDigest: Buffer, now: Date) => Promise<void>;
  readonly markRetry: (outboxId: string, code: string, nextAttemptAt: Date, now: Date) => Promise<void>;
  /** The provider may have accepted it: never sent again (body erased); confirmed by a report or FAILED after `confirmBy`. */
  readonly markUncertain: (outboxId: string, code: string, confirmBy: Date, now: Date) => Promise<void>;
  /** Terminal without delivery: FAILED (refused), DEAD (attempts exhausted) or SKIPPED (never attempted). The body is erased. */
  readonly markEnded: (outboxId: string, status: 'FAILED' | 'DEAD' | 'SKIPPED', code: string, now: Date) => Promise<void>;
  /** A send claimed before `staleBefore` never finished (a crash mid-send): UNCERTAIN until `confirmBy`, never resent. */
  readonly settleStale: (conversationId: string, staleBefore: Date, confirmBy: Date, now: Date) => Promise<number>;
  /** UNCERTAIN messages whose confirmation time passed become FAILED (SEND_OUTCOME_UNKNOWN); returned so lost links are withdrawn. */
  readonly expireUncertain: (conversationId: string, now: Date) => Promise<readonly OutboxRecord[]>;
  /** A provider status report, applied monotonically (SENT < DELIVERED < READ; FAILED is terminal). Unknown messages are ignored. */
  readonly applyDelivery: (correlationId: string | null, providerDigest: Buffer, status: DeliveryRank, errorCode: string | null, now: Date) => Promise<boolean>;
  /** Inserts notifications for a conversation outside a turn (no lease needed: keys deduplicate them). */
  readonly enqueue: (conversationId: string, outbox: readonly NewOutbox[], now: Date) => Promise<readonly string[]>;
  /** Fixed-window abuse limit: true while `bucket` stays within `limit` per `windowSeconds`. */
  readonly allow: (bucket: string, limit: number, windowSeconds: number, now: Date) => Promise<boolean>;
  /** Retention: erases stranded payloads, unsent bodies, idle state and lapsed addresses; deletes old records and audit rows. */
  readonly purge: (now: Date) => Promise<void>;

  // ── The scheduled dispatch (`dispatch.ts`) ──────────────────────────────────────────────────────────────────────────────────
  /** Conversations with a pending event and no live lease (a turn that never ran or crashed): their next holder processes them. */
  readonly strandedConversations: (now: Date, limit: number) => Promise<readonly ConversationRef[]>;
  /** Conversations with outbound work (a due message, a stale send, an UNCERTAIN message past its confirmation time) and no live lease. */
  readonly dueConversations: (now: Date, staleBefore: Date, limit: number) => Promise<readonly ConversationRef[]>;
  /** Approvals created by turns since `since` and not yet settled, newest first, for status notifications. */
  readonly watchedHandoffs: (since: Date, limit: number) => Promise<readonly WatchedHandoff[]>;
  /** Nothing more can be reported about this approval: the sweep stops following it. */
  readonly settleHandoff: (handoffId: string) => Promise<void>;
  /** Appends content-free audit rows (closed codes and opaque ids only). */
  readonly audit: (entries: readonly AuditEntry[], now: Date) => Promise<void>;
}

/** One content-free audit row. */
export type AuditEntry = { readonly channel: ChannelId; readonly conversationId: string | null; readonly kind: string; readonly code?: string | null;
  readonly handoffId?: string | null; readonly outboxId?: string | null };

/** Retention bounds (§3.10 of the plan). */
export const RETENTION = Object.freeze({
  /** A payload or an unsent body never outlives this. */
  transientMs: 15 * 60_000,
  /** Conversation state (bounded transcript, open question, pending proposal) is erased after this much inactivity. */
  stateIdleMs: 30 * 60_000,
  /**
   * The send address is erased this long after the user's last message: WhatsApp's 24-hour window plus 24 hours in which a status
   * notification may still go out through an approved template.
   */
  addressMs: 48 * 3_600_000,
  /** Content-free event and outbox records (deduplication and audit) are kept this long; providers retry for up to 7 days. */
  recordMs: 8 * 86_400_000,
  /** An idle conversation record is deleted after this long, unless it records an opt-out. */
  conversationIdleMs: 7 * 86_400_000,
  /** Content-free audit rows are kept this long. */
  auditMs: 30 * 86_400_000,
  /** An approval is followed for status notifications this long after the turn that created it. */
  watchMs: 2 * 86_400_000,
});
