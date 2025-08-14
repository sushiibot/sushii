import type { Attachment, GuildMember, User } from "discord.js";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import { ActionType } from "../value-objects/ActionType";
import type { DMChoice } from "../value-objects/DMChoice";
import type { Duration } from "../value-objects/Duration";
import type { Reason } from "../value-objects/Reason";

export abstract class ModerationAction {
  protected constructor(
    private readonly _actionType: ActionType,
    private readonly _guildId: string,
    private readonly _executor: User,
    private readonly _executorMember: GuildMember | null,
    private readonly _reason: Reason | null,
    private readonly _dmChoice: DMChoice,
    private readonly _attachment: Attachment | null = null,
  ) {}

  get actionType(): ActionType {
    return this._actionType;
  }

  get guildId(): string {
    return this._guildId;
  }

  get executor(): User {
    return this._executor;
  }

  get executorMember(): GuildMember | null {
    return this._executorMember;
  }

  get reason(): Reason | null {
    return this._reason;
  }

  get attachment(): Attachment | null {
    return this._attachment;
  }

  get dmChoice(): DMChoice {
    return this._dmChoice;
  }

  abstract validate(): Result<void, string>;

  protected validateBasicPermissions(): Result<void, string> {
    return Ok.EMPTY;
  }

  // Type Guards
  isBanAction(): this is BanAction {
    return this.actionType === ActionType.Ban;
  }

  isTempBanAction(): this is TempBanAction {
    return this.actionType === ActionType.TempBan;
  }

  isTimeoutAction(): this is TimeoutAction {
    return this.actionType === ActionType.Timeout;
  }

  isBanOrTempBanAction(): this is BanAction | TempBanAction {
    return this.isBanAction() || this.isTempBanAction();
  }

  isKickAction(): this is KickAction {
    return this.actionType === ActionType.Kick;
  }

  isWarnAction(): this is WarnAction {
    return this.actionType === ActionType.Warn;
  }

  shouldSendDMBeforeAction(): boolean {
    // Ban, TempBan, Kick, and Warn should all send DMs before the action
    // to ensure the user receives the notification
    const actionType = this.actionType;
    return (
      this.isBanOrTempBanAction() ||
      this.isKickAction() ||
      actionType === ActionType.Warn
    );
  }

  isTemporalAction(): this is TempBanAction | TimeoutAction {
    return this.isTempBanAction() || this.isTimeoutAction();
  }
}

export class BanAction extends ModerationAction {
  constructor(
    guildId: string,
    executor: User,
    executorMember: GuildMember | null,
    reason: Reason | null,
    dmChoice: DMChoice,
    attachment: Attachment | null = null,
    private readonly _deleteMessageDays?: number,
  ) {
    super(
      ActionType.Ban,
      guildId,
      executor,
      executorMember,
      reason,
      dmChoice,
      attachment,
    );
  }

  get deleteMessageDays(): number | undefined {
    return this._deleteMessageDays;
  }

  validate(): Result<void, string> {
    const basicValidation = this.validateBasicPermissions();
    if (!basicValidation.ok) {
      return basicValidation;
    }

    if (this._deleteMessageDays !== undefined) {
      if (this._deleteMessageDays < 0 || this._deleteMessageDays > 7) {
        return Err("Delete message days must be between 0 and 7");
      }
    }

    return Ok.EMPTY;
  }
}

export class TempBanAction extends ModerationAction {
  constructor(
    guildId: string,
    executor: User,
    executorMember: GuildMember | null,
    reason: Reason | null,
    dmChoice: DMChoice,
    private readonly _duration: Duration,
    attachment: Attachment | null = null,
    private readonly _deleteMessageDays?: number,
  ) {
    super(
      ActionType.TempBan,
      guildId,
      executor,
      executorMember,
      reason,
      dmChoice,
      attachment,
    );
  }

  get duration(): Duration {
    return this._duration;
  }

  get deleteMessageDays(): number | undefined {
    return this._deleteMessageDays;
  }

  validate(): Result<void, string> {
    const basicValidation = this.validateBasicPermissions();
    if (!basicValidation.ok) {
      return basicValidation;
    }

    if (this._deleteMessageDays !== undefined) {
      if (this._deleteMessageDays < 0 || this._deleteMessageDays > 7) {
        return Err("Delete message days must be between 0 and 7");
      }
    }

    return Ok.EMPTY;
  }
}

export class UnbanAction extends ModerationAction {
  constructor(
    guildId: string,
    executor: User,
    executorMember: GuildMember | null,
    reason: Reason | null,
    dmChoice: DMChoice,
    attachment: Attachment | null = null,
  ) {
    super(
      ActionType.BanRemove,
      guildId,
      executor,
      executorMember,
      reason,
      dmChoice,
      attachment,
    );
  }

  validate(): Result<void, string> {
    const basicValidation = this.validateBasicPermissions();
    if (!basicValidation.ok) {
      return basicValidation;
    }

    return Ok.EMPTY;
  }
}

export class KickAction extends ModerationAction {
  constructor(
    guildId: string,
    executor: User,
    executorMember: GuildMember | null,
    reason: Reason | null,
    dmChoice: DMChoice,
    attachment: Attachment | null = null,
  ) {
    super(
      ActionType.Kick,
      guildId,
      executor,
      executorMember,
      reason,
      dmChoice,
      attachment,
    );
  }

  validate(): Result<void, string> {
    const basicValidation = this.validateBasicPermissions();
    if (!basicValidation.ok) {
      return basicValidation;
    }

    return Ok.EMPTY;
  }
}

// Discord timeout limits
const MIN_TIMEOUT_SECONDS = 10;
const MAX_TIMEOUT_SECONDS = 2419200; // 28 days in seconds

export class TimeoutAction extends ModerationAction {
  constructor(
    guildId: string,
    executor: User,
    executorMember: GuildMember | null,
    reason: Reason | null,
    dmChoice: DMChoice,
    attachment: Attachment | null = null,
    private readonly _duration: Duration,
  ) {
    super(
      ActionType.Timeout,
      guildId,
      executor,
      executorMember,
      reason,
      dmChoice,
      attachment,
    );
  }

  get duration(): Duration {
    return this._duration;
  }

  validate(): Result<void, string> {
    const basicValidation = this.validateBasicPermissions();
    if (!basicValidation.ok) {
      return basicValidation;
    }

    // Validate timeout duration limits
    const durationSeconds = this._duration.asSeconds();

    if (durationSeconds < MIN_TIMEOUT_SECONDS) {
      return Err(
        `Timeout duration '${this._duration.originalString}' is less than the minimum of 10 seconds`,
      );
    }

    if (durationSeconds > MAX_TIMEOUT_SECONDS) {
      return Err(
        `Timeout duration '${this._duration.originalString}' exceeds the maximum of 28 days (Discord limit)`,
      );
    }

    return Ok.EMPTY;
  }
}

export class UnTimeoutAction extends ModerationAction {
  constructor(
    guildId: string,
    executor: User,
    executorMember: GuildMember | null,
    reason: Reason | null,
    dmChoice: DMChoice,
    attachment: Attachment | null = null,
  ) {
    super(
      ActionType.TimeoutRemove,
      guildId,
      executor,
      executorMember,
      reason,
      dmChoice,
      attachment,
    );
  }

  validate(): Result<void, string> {
    const basicValidation = this.validateBasicPermissions();
    if (!basicValidation.ok) {
      return basicValidation;
    }

    return Ok.EMPTY;
  }
}

export class WarnAction extends ModerationAction {
  constructor(
    guildId: string,
    executor: User,
    executorMember: GuildMember | null,
    reason: Reason | null,
    dmChoice: DMChoice,
    attachment: Attachment | null = null,
  ) {
    super(
      ActionType.Warn,
      guildId,
      executor,
      executorMember,
      reason,
      dmChoice,
      attachment,
    );
  }

  validate(): Result<void, string> {
    const basicValidation = this.validateBasicPermissions();
    if (!basicValidation.ok) {
      return basicValidation;
    }

    return Ok.EMPTY;
  }
}

export class NoteAction extends ModerationAction {
  constructor(
    guildId: string,
    executor: User,
    executorMember: GuildMember | null,
    reason: Reason | null,
    dmChoice: DMChoice,
    attachment: Attachment | null = null,
  ) {
    super(
      ActionType.Note,
      guildId,
      executor,
      executorMember,
      reason,
      dmChoice,
      attachment,
    );
  }

  validate(): Result<void, string> {
    return Ok.EMPTY;
  }
}
