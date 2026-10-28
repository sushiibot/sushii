import type { ActionType } from "../value-objects/ActionType";
import type { Reason } from "../value-objects/Reason";

export interface DMResult {
  channelId?: string;
  messageId?: string;
  error?: string;
  failureReason?: DMFailureReason | null;
}

export type DMIntentSource =
  | "executor_yes"
  | "executor_no"
  | "guild_default"
  | "warn_always"
  | "action_not_supported"
  | "unknown";
export type DMNotAttemptedReason = "user_not_in_guild";
export type DMFailureReason =
  | "user_blocked"
  | "user_privacy"
  | "user_cannot_receive"
  | "unknown";

export class ModerationCase {
  constructor(
    private readonly _guildId: string,
    private readonly _caseId: string,

    private readonly _actionType: ActionType,
    private readonly _actionTime: Date,
    private readonly _userId: string,
    private readonly _userTag: string,
    private readonly _executorId: string | null,
    private readonly _reason: Reason | null,
    private readonly _msgId: string | null = null,
    private readonly _attachments: string[] = [],
    private readonly _dmResult: DMResult | null = null,
    private readonly _pending: boolean = false,
    private readonly _timeoutDuration: number | null = null,
    // DM intent tracking
    private readonly _dmIntended: boolean = false,
    private readonly _dmIntentSource: DMIntentSource = "unknown",
    private readonly _dmAttempted: boolean = false,
    private readonly _dmNotAttemptedReason: DMNotAttemptedReason | null = null,
    private readonly _dmFailureReason: DMFailureReason | null = null,
    private readonly _deleteMessageSeconds: number | null = null,
    private readonly _dmDeleted: boolean = false,
    private readonly _reasonSetBy: string | null = null,
    private readonly _reasonSetAt: Date | null = null,
    private readonly _dmDeletedBy: string | null = null,
    private readonly _dmDeletedAt: Date | null = null,
  ) {}

  static create(
    guildId: string,
    caseId: string,
    actionType: ActionType,
    userId: string,
    userTag: string,
    executorId: string | null,
    reason: Reason | null,
    msgId?: string,
    attachments?: string[],
    timeoutDuration?: number | null,
    deleteMessageSeconds?: number | null,
  ): ModerationCase {
    return new ModerationCase(
      guildId,
      caseId,
      actionType,
      new Date(),
      userId,
      userTag,
      executorId,
      reason,
      msgId,
      attachments || [],
      null,
      false,
      timeoutDuration ?? null,
      false,
      "unknown",
      false,
      null,
      null,
      deleteMessageSeconds ?? null,
    );
  }

  get guildId(): string {
    return this._guildId;
  }

  get caseId(): string {
    return this._caseId;
  }

  get actionType(): ActionType {
    return this._actionType;
  }

  get actionTime(): Date {
    return this._actionTime;
  }

  get userId(): string {
    return this._userId;
  }

  get userTag(): string {
    return this._userTag;
  }

  get executorId(): string | null {
    return this._executorId;
  }

  get reason(): Reason | null {
    return this._reason;
  }

  get msgId(): string | null {
    return this._msgId;
  }

  get attachments(): string[] {
    return this._attachments;
  }

  get dmResult(): DMResult | null {
    return this._dmResult;
  }

  get pending(): boolean {
    return this._pending;
  }

  get dmFailed(): boolean {
    return this._dmResult?.error !== undefined;
  }

  get dmSuccess(): boolean {
    return this._dmResult?.messageId !== undefined;
  }

  get dmAttempted(): boolean {
    return this._dmAttempted;
  }

  get timeoutDuration(): number | null {
    return this._timeoutDuration;
  }

  get dmIntended(): boolean {
    return this._dmIntended;
  }

  get dmIntentSource(): DMIntentSource {
    return this._dmIntentSource;
  }

  get dmNotAttemptedReason(): DMNotAttemptedReason | null {
    return this._dmNotAttemptedReason;
  }

  get dmFailureReason(): DMFailureReason | null {
    return this._dmFailureReason;
  }

  get deleteMessageSeconds(): number | null {
    return this._deleteMessageSeconds;
  }

  get dmDeleted(): boolean {
    return this._dmDeleted;
  }

  get reasonSetBy(): string | null {
    return this._reasonSetBy;
  }

  get reasonSetAt(): Date | null {
    return this._reasonSetAt;
  }

  /** Null for DMs deleted before this was recorded. */
  get dmDeletedBy(): string | null {
    return this._dmDeletedBy;
  }

  get dmDeletedAt(): Date | null {
    return this._dmDeletedAt;
  }

  withDMResult(dmResult: DMResult): ModerationCase {
    const dmAttempted =
      dmResult.messageId !== undefined || dmResult.error !== undefined;
    let dmFailureReason: DMFailureReason | null = null;

    if (dmResult.error) {
      dmFailureReason = dmResult.failureReason ?? "unknown";
    }

    return new ModerationCase(
      this._guildId,
      this._caseId,
      this._actionType,
      this._actionTime,
      this._userId,
      this._userTag,
      this._executorId,
      this._reason,
      this._msgId,
      this._attachments,
      dmResult,
      this._pending,
      this._timeoutDuration,
      this._dmIntended,
      this._dmIntentSource,
      dmAttempted,
      this._dmNotAttemptedReason,
      dmFailureReason,
      this._deleteMessageSeconds,
      this._dmDeleted,
      this._reasonSetBy,
      this._reasonSetAt,
      this._dmDeletedBy,
      this._dmDeletedAt,
    );
  }

  withDMIntent(
    intended: boolean,
    source: DMIntentSource,
    notAttemptedReason?: DMNotAttemptedReason,
  ): ModerationCase {
    return new ModerationCase(
      this._guildId,
      this._caseId,
      this._actionType,
      this._actionTime,
      this._userId,
      this._userTag,
      this._executorId,
      this._reason,
      this._msgId,
      this._attachments,
      this._dmResult,
      this._pending,
      this._timeoutDuration,
      intended,
      source,
      this._dmAttempted,
      notAttemptedReason || null,
      this._dmFailureReason,
      this._deleteMessageSeconds,
      this._dmDeleted,
      this._reasonSetBy,
      this._reasonSetAt,
      this._dmDeletedBy,
      this._dmDeletedAt,
    );
  }

  withPending(pending: boolean): ModerationCase {
    return new ModerationCase(
      this._guildId,
      this._caseId,
      this._actionType,
      this._actionTime,
      this._userId,
      this._userTag,
      this._executorId,
      this._reason,
      this._msgId,
      this._attachments,
      this._dmResult,
      pending,
      this._timeoutDuration,
      this._dmIntended,
      this._dmIntentSource,
      this._dmAttempted,
      this._dmNotAttemptedReason,
      this._dmFailureReason,
      this._deleteMessageSeconds,
      this._dmDeleted,
      this._reasonSetBy,
      this._reasonSetAt,
      this._dmDeletedBy,
      this._dmDeletedAt,
    );
  }

  withReason(reason: Reason | null): ModerationCase {
    return new ModerationCase(
      this._guildId,
      this._caseId,
      this._actionType,
      this._actionTime,
      this._userId,
      this._userTag,
      this._executorId,
      reason,
      this._msgId,
      this._attachments,
      this._dmResult,
      this._pending,
      this._timeoutDuration,
      this._dmIntended,
      this._dmIntentSource,
      this._dmAttempted,
      this._dmNotAttemptedReason,
      this._dmFailureReason,
      this._deleteMessageSeconds,
      this._dmDeleted,
      this._reasonSetBy,
      this._reasonSetAt,
      this._dmDeletedBy,
      this._dmDeletedAt,
    );
  }

  withExecutor(executorId: string | null): ModerationCase {
    return new ModerationCase(
      this._guildId,
      this._caseId,
      this._actionType,
      this._actionTime,
      this._userId,
      this._userTag,
      executorId,
      this._reason,
      this._msgId,
      this._attachments,
      this._dmResult,
      this._pending,
      this._timeoutDuration,
      this._dmIntended,
      this._dmIntentSource,
      this._dmAttempted,
      this._dmNotAttemptedReason,
      this._dmFailureReason,
      this._deleteMessageSeconds,
      this._dmDeleted,
      this._reasonSetBy,
      this._reasonSetAt,
      this._dmDeletedBy,
      this._dmDeletedAt,
    );
  }

  withDmDeleted(
    by: string | null = null,
    at: Date | null = null,
  ): ModerationCase {
    return new ModerationCase(
      this._guildId,
      this._caseId,
      this._actionType,
      this._actionTime,
      this._userId,
      this._userTag,
      this._executorId,
      this._reason,
      this._msgId,
      this._attachments,
      this._dmResult,
      this._pending,
      this._timeoutDuration,
      this._dmIntended,
      this._dmIntentSource,
      this._dmAttempted,
      this._dmNotAttemptedReason,
      this._dmFailureReason,
      this._deleteMessageSeconds,
      true,
      this._reasonSetBy,
      this._reasonSetAt,
      by,
      at,
    );
  }

  withReasonSetBy(userId: string, at: Date): ModerationCase {
    return new ModerationCase(
      this._guildId,
      this._caseId,
      this._actionType,
      this._actionTime,
      this._userId,
      this._userTag,
      this._executorId,
      this._reason,
      this._msgId,
      this._attachments,
      this._dmResult,
      this._pending,
      this._timeoutDuration,
      this._dmIntended,
      this._dmIntentSource,
      this._dmAttempted,
      this._dmNotAttemptedReason,
      this._dmFailureReason,
      this._deleteMessageSeconds,
      this._dmDeleted,
      userId,
      at,
      this._dmDeletedBy,
      this._dmDeletedAt,
    );
  }
}
