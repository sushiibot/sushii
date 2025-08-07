import {
  Attachment,
  ChatInputCommandInteraction,
  GuildMember,
  InteractionContextType,
  PermissionFlagsBits,
  RESTPostAPIApplicationCommandsJSONBody,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import { Err, Ok, Result } from "ts-results";

import { buildActionResultMessage } from "@/features/moderation/actions/presentation/views/ModerationActionView";
import {
  BanAction,
  KickAction,
  ModerationAction,
  NoteAction,
  TempBanAction,
  TimeoutAction,
  UnTimeoutAction,
  UnbanAction,
  WarnAction,
} from "@/features/moderation/shared/domain/entities/ModerationAction";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import {
  DMChoice,
  dmChoiceFromString,
} from "@/features/moderation/shared/domain/value-objects/DMChoice";
import { Duration } from "@/features/moderation/shared/domain/value-objects/Duration";
import { Reason } from "@/features/moderation/shared/domain/value-objects/Reason";
import { OPTION_NAMES } from "@/features/moderation/shared/presentation/commands/ModerationCommandConstants";
import { SlashCommandHandler } from "@/interactions/handlers";
import {
  getErrorMessage,
  getErrorMessageEdit,
} from "@/interactions/responses/error";

import { ModerationService } from "../../application/ModerationService";
import { TargetResolutionService } from "../../application/TargetResolutionService";

export interface ModerationCommandConfig {
  actionType: ActionType;
  name: string;
  description: string;
  permissions: (typeof PermissionFlagsBits)[keyof typeof PermissionFlagsBits];
  options: (
    builder: SlashCommandBuilder,
  ) => SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
  requiresReason?: boolean;
}

interface ParsedOptions {
  reason: Reason | null;
  attachment: Attachment | null;
  dmChoice: DMChoice;
  deleteMessageDays: number | null;
  duration: string | null;
  channelId: string | null;
}

export class ModerationCommand extends SlashCommandHandler {
  public readonly command: RESTPostAPIApplicationCommandsJSONBody;

  constructor(
    private readonly config: ModerationCommandConfig,
    private readonly moderationService: ModerationService,
    private readonly targetResolutionService: TargetResolutionService,
  ) {
    super();

    const builder = new SlashCommandBuilder()
      .setName(this.config.name)
      .setDescription(this.config.description)
      .setContexts(InteractionContextType.Guild)
      .setDefaultMemberPermissions(this.config.permissions);

    this.command = this.config.options(builder).toJSON();
  }

  private parseAllOptions(
    interaction: ChatInputCommandInteraction,
  ): ParsedOptions {
    return {
      reason: this.parseReason(interaction),
      attachment: interaction.options.getAttachment(OPTION_NAMES.ATTACHMENT),
      dmChoice: this.parseDmChoice(interaction),
      deleteMessageDays: interaction.options.getInteger(
        OPTION_NAMES.DAYS_TO_DELETE,
      ),
      duration: interaction.options.getString(OPTION_NAMES.DURATION),
      channelId:
        interaction.options.getChannel(OPTION_NAMES.CHANNEL)?.id ?? null,
    };
  }

  private parseReason(interaction: ChatInputCommandInteraction): Reason | null {
    // For note commands, check the "note" option, otherwise check "reason"
    const reasonString =
      this.config.actionType === ActionType.Note
        ? interaction.options.getString(OPTION_NAMES.NOTE)
        : interaction.options.getString(OPTION_NAMES.REASON);
    const result = Reason.create(reasonString);
    return result.ok ? result.val : null;
  }

  private parseDmChoice(interaction: ChatInputCommandInteraction): DMChoice {
    const dmString = interaction.options.getString(OPTION_NAMES.DM_REASON);
    return dmChoiceFromString(dmString);
  }

  private createActionFromType(
    actionType: ActionType,
    interaction: ChatInputCommandInteraction,
    options: ParsedOptions,
  ): Result<ModerationAction, string> {
    const base = {
      guildId: interaction.guildId ?? "",
      executor: interaction.user,
      executorMember: interaction.member as GuildMember | null,
      reason: options.reason,
      dmChoice: options.dmChoice,
      attachment: options.attachment,
    };

    try {
      switch (actionType) {
        case ActionType.Ban: {
          return Ok(
            new BanAction(
              base.guildId,
              base.executor,
              base.executorMember,
              base.reason,
              base.dmChoice,
              base.attachment,
              options.deleteMessageDays ?? undefined,
            ),
          );
        }

        case ActionType.TempBan: {
          if (!options.duration) {
            return Err("Duration is required for temporary bans");
          }
          const durationResult = Duration.create(options.duration);
          if (!durationResult.ok) {
            return Err(`Invalid duration: ${durationResult.val}`);
          }
          if (!durationResult.val) {
            return Err("Duration cannot be null for temporary bans");
          }
          return Ok(
            new TempBanAction(
              base.guildId,
              base.executor,
              base.executorMember,
              base.reason,
              base.dmChoice,
              durationResult.val,
              base.attachment,
            ),
          );
        }

        case ActionType.BanRemove: {
          return Ok(
            new UnbanAction(
              base.guildId,
              base.executor,
              base.executorMember,
              base.reason,
              base.dmChoice,
              base.attachment,
            ),
          );
        }

        case ActionType.Kick: {
          return Ok(
            new KickAction(
              base.guildId,
              base.executor,
              base.executorMember,
              base.reason,
              base.dmChoice,
              base.attachment,
            ),
          );
        }

        case ActionType.Timeout: {
          if (!options.duration) {
            return Err("Duration is required for timeouts");
          }
          const timeoutDurationResult = Duration.create(options.duration);
          if (!timeoutDurationResult.ok) {
            return Err(`Invalid duration: ${timeoutDurationResult.val}`);
          }
          if (!timeoutDurationResult.val) {
            return Err("Duration cannot be null for timeouts");
          }
          return Ok(
            new TimeoutAction(
              base.guildId,
              base.executor,
              base.executorMember,
              base.reason,
              base.dmChoice,
              base.attachment,
              timeoutDurationResult.val,
            ),
          );
        }
        case ActionType.TimeoutRemove: {
          return Ok(
            new UnTimeoutAction(
              base.guildId,
              base.executor,
              base.executorMember,
              base.reason,
              base.dmChoice,
              base.attachment,
            ),
          );
        }

        case ActionType.Warn: {
          if (this.config.requiresReason && !options.reason) {
            return Err("Reason is required for warnings");
          }
          return Ok(
            new WarnAction(
              base.guildId,
              base.executor,
              base.executorMember,
              base.reason,
              base.dmChoice,
              base.attachment,
            ),
          );
        }

        case ActionType.Note: {
          if (!options.reason) {
            return Err("Note is required for notes");
          }

          return Ok(
            new NoteAction(
              base.guildId,
              base.executor,
              base.executorMember,
              base.reason,
              base.dmChoice,
              base.attachment,
            ),
          );
        }

        default:
          return Err(`Unsupported action type: ${actionType}`);
      }
    } catch (error) {
      return Err(
        `Failed to create action: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not in cached guild");
    }

    const options = this.parseAllOptions(interaction);

    // Validate reason if required
    if (this.config.requiresReason && !options.reason) {
      await interaction.reply(
        getErrorMessage("Error", "Reason is required for this action"),
      );
      return;
    }

    await interaction.deferReply();

    const targetsResult =
      await this.targetResolutionService.fetchTargets(interaction);
    if (!targetsResult.ok) {
      const editMsg = getErrorMessageEdit("Error", targetsResult.val);
      await interaction.editReply(editMsg);
      return;
    }

    const targets = targetsResult.val;

    const actionResult = this.createActionFromType(
      this.config.actionType,
      interaction,
      options,
    );

    if (!actionResult.ok) {
      const editMsg = getErrorMessageEdit("Error", actionResult.val);
      await interaction.editReply(editMsg);
      return;
    }

    const action = actionResult.val;
    const result = await this.moderationService.executeAction(action, targets);

    const message = buildActionResultMessage(
      this.config.actionType,
      interaction.user,
      targets,
      result,
    );

    await interaction.editReply(message);
  }
}
