import { ActionType } from "../value-objects/ActionType";
import { Reason } from "../value-objects/Reason";

export interface DMResult {
  channelId?: string;
  messageId?: string;
  error?: string;
}

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

  withDMResult(dmResult: DMResult): ModerationCase {
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
    );
  }
}
