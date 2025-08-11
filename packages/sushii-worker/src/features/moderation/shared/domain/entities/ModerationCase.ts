import type { ActionType } from "../value-objects/ActionType";
import type { Reason } from "../value-objects/Reason";

export interface DMResult {
  channelId?: string;
  messageId?: string;
  error?: string;
}

export type DMIntentSource =
  | "executor_yes"
  | "executor_no"
  | "guild_default"
  | "warn_always"
  | "action_not_supported"
  | "unknown";
export type DMNotAttemptedReason = "user_not_in_guild";
export type DMFailureReason = "user_cannot_receive" | "unknown";

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
      timeoutDuration || null,
      false,
      "unknown",
      false,
      null,
      null,
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
    return this._dmResult !== null;
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

  withDMResult(dmResult: DMResult): ModerationCase {
    // Determine if DM was attempted and failure reason
    const dmAttempted =
      dmResult.messageId !== undefined || dmResult.error !== undefined;
    let dmFailureReason: DMFailureReason | null = null;

    if (dmResult.error) {
      // Categorize the error
      if (
        dmResult.error.includes("Cannot send messages to this user") ||
        dmResult.error.includes("privacy settings") ||
        dmResult.error.includes("bot blocked")
      ) {
        dmFailureReason = "user_cannot_receive";
      } else {
        dmFailureReason = "unknown";
      }
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
    );
  }
}
