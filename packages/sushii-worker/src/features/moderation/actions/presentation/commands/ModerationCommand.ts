import type {
  Attachment,
  ChatInputCommandInteraction,
  GuildMember,
  Message,
  PermissionFlagsBits,
  RESTPostAPIApplicationCommandsJSONBody,
  SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import {
  ApplicationIntegrationType,
  AttachmentBuilder,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { BotEmojiRepository } from "@/features/bot-emojis";
import {
  type ActionResponseMessage,
  MODERATION_ACTION_EMOJIS,
  type ModerationActionEmojis,
  buildActionResultMessage,
  templateNote,
  unknownShortcutNote,
} from "@/features/moderation/actions/presentation/views/ModerationActionView";
import type { ReasonTemplateService } from "@/features/moderation/reason-templates/application/ReasonTemplateService";
import type { ExpandResult } from "@/features/moderation/reason-templates/domain/ReasonExpander";
import type { ModerationAction } from "@/features/moderation/shared/domain/entities/ModerationAction";
import {
  BanAction,
  KickAction,
  NoteAction,
  SoftbanAction,
  TempBanAction,
  TimeoutAction,
  UnTimeoutAction,
  UnbanAction,
  WarnAction,
} from "@/features/moderation/shared/domain/entities/ModerationAction";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import type { ModerationMetrics } from "@/features/moderation/shared/domain/metrics/ModerationMetrics";
import {
  NOOP_MODERATION_METRICS,
  reasonSource,
} from "@/features/moderation/shared/domain/metrics/ModerationMetrics";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import type { DMChoice } from "@/features/moderation/shared/domain/value-objects/DMChoice";
import { dmChoiceFromString } from "@/features/moderation/shared/domain/value-objects/DMChoice";
import { Duration } from "@/features/moderation/shared/domain/value-objects/Duration";
import {
  REASON_MAX_LENGTH,
  Reason,
} from "@/features/moderation/shared/domain/value-objects/Reason";
import {
  isGalleryMedia,
  safeAttachmentName,
} from "@/features/moderation/shared/presentation/caseMedia";
import { OPTION_NAMES } from "@/features/moderation/shared/presentation/commands/ModerationCommandConstants";
import {
  getErrorMessage,
  getErrorMessageEdit,
} from "@/interactions/responses/error";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { ModerationService } from "../../application/ModerationService";
import type { TargetResolutionService } from "../../application/TargetResolutionService";
import {
  UNRESOLVED_TEMPLATE_MESSAGE,
  buildReasonFormError,
} from "../components/reasonFormSubmit";
import {
  type ResponseExpiryScheduler,
  scheduleResponseExpiry,
} from "../response/responseExpiry";

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

export type ModerationCommandTemplates = Pick<
  ReasonTemplateService,
  "resolve" | "recordUse" | "shouldPromptSave"
>;

const number = new Intl.NumberFormat("en-US");

/** Expanded reason text that's too long; the action is refused. */
export function expandedTooLongMessage(
  length: number,
  template: ExpandResult["template"],
): string {
  let what = "expanding the recent reason";
  if (template?.shortcut) {
    what = `expanding \`!${template.shortcut}\``;
  } else if (template) {
    what = "expanding the template";
  }
  return `**Nothing was done.** The reason is ${number.format(length)} characters after ${what}; the limit is ${number.format(REASON_MAX_LENGTH)}. Shorten the extra text by ${number.format(length - REASON_MAX_LENGTH)} characters.`;
}

/** Upper bound on fetching the attachment before the response goes out without it. */
const ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 10_000;

/** Larger files are buffered in memory and slow the response, so they keep their original link. */
const ATTACHMENT_REHOST_MAX_BYTES = 25 * 1024 * 1024;

interface UploadFile {
  name: string;
  data: Buffer;
}

interface ParsedOptions {
  reason: Reason | null;
  attachment: Attachment | null;
  dmChoice: DMChoice;
  deleteMessageDays: number | null;
  deleteMessageSeconds: number | null;
  duration: string | null;
  channelId: string | null;
}

export class ModerationCommand extends SlashCommandHandler {
  public readonly command: RESTPostAPIApplicationCommandsJSONBody;

  constructor(
    private readonly config: ModerationCommandConfig,
    private readonly moderationService: ModerationService,
    private readonly targetResolutionService: TargetResolutionService,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly emojiRepository: BotEmojiRepository,
    private readonly reasonTemplateService: ModerationCommandTemplates,
    private readonly logger: Logger,
    private readonly scheduleExpiry: ResponseExpiryScheduler = scheduleResponseExpiry,
    private readonly metrics: Pick<
      ModerationMetrics,
      "recordReasonResolved" | "recordSavePrompt"
    > = NOOP_MODERATION_METRICS,
  ) {
    super();

    const builder = new SlashCommandBuilder()
      .setName(this.config.name)
      .setDescription(this.config.description)
      .setContexts(InteractionContextType.Guild)
      .setDefaultMemberPermissions(this.config.permissions)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall);

    this.command = this.config.options(builder).toJSON();
  }

  private parseAllOptions(
    interaction: ChatInputCommandInteraction,
    reasonText: string | null,
  ): Result<ParsedOptions, string> {
    const reasonResult = Reason.create(reasonText);
    if (!reasonResult.ok) {
      return reasonResult;
    }

    return Ok({
      reason: reasonResult.val,
      attachment: interaction.options.getAttachment(OPTION_NAMES.ATTACHMENT),
      dmChoice: this.parseDmChoice(interaction),
      deleteMessageDays: interaction.options.getInteger(
        OPTION_NAMES.DAYS_TO_DELETE,
      ),
      deleteMessageSeconds: interaction.options.getInteger(
        OPTION_NAMES.DELETE_MESSAGES,
      ),
      duration: interaction.options.getString(OPTION_NAMES.DURATION),
      channelId:
        interaction.options.getChannel(OPTION_NAMES.CHANNEL)?.id ?? null,
    });
  }

  /** Notes keep the typed text; reasons expand templates and !shortcuts. */
  private async resolveReason(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<{ text: string | null; expansion: ExpandResult | null }> {
    if (this.config.actionType === ActionType.Note) {
      return {
        text: interaction.options.getString(OPTION_NAMES.NOTE),
        expansion: null,
      };
    }

    const raw = interaction.options.getString(OPTION_NAMES.REASON);
    const expansion = await this.reasonTemplateService.resolve(
      interaction.guildId,
      raw,
    );
    return { text: expansion ? expansion.text : raw, expansion };
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

        case ActionType.Softban: {
          if (options.deleteMessageSeconds === null) {
            return Err("Delete message duration is required for softban");
          }
          return Ok(
            new SoftbanAction(
              base.guildId,
              base.executor,
              base.executorMember,
              base.reason,
              base.dmChoice,
              options.deleteMessageSeconds,
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

    const [{ text: reasonText, expansion }, emojis] = await Promise.all([
      this.resolveReason(interaction),
      this.emojiRepository.getEmojis(MODERATION_ACTION_EMOJIS),
    ]);

    if (expansion) {
      const source = reasonSource({
        surface: "command",
        expanded: expansion,
        tooLong: expansion.text.length > REASON_MAX_LENGTH,
        hasText: !!expansion.text,
      });
      if (source) {
        this.metrics.recordReasonResolved("command", source);
      }
    }

    if (expansion?.unresolved) {
      await interaction.reply(
        buildReasonFormError(UNRESOLVED_TEMPLATE_MESSAGE, emojis),
      );
      return;
    }

    if (expansion && expansion.text.length > REASON_MAX_LENGTH) {
      await interaction.reply(
        buildReasonFormError(
          expandedTooLongMessage(expansion.text.length, expansion.template),
          emojis,
        ),
      );
      return;
    }

    const optionsResult = this.parseAllOptions(interaction, reasonText);
    if (!optionsResult.ok) {
      await interaction.reply(getErrorMessage("Error", optionsResult.val));
      return;
    }

    const options = optionsResult.val;

    // Validate reason if required
    if (this.config.requiresReason && !options.reason) {
      await interaction.reply(
        getErrorMessage("Error", "Reason is required for this action"),
      );
      return;
    }

    // Create and validate action BEFORE fetching targets
    const actionResult = this.createActionFromType(
      this.config.actionType,
      interaction,
      options,
    );

    if (!actionResult.ok) {
      await interaction.reply(getErrorMessage("Error", actionResult.val));
      return;
    }

    const action = actionResult.val;

    // Validate the action (including duration limits for timeouts)
    const validationResult = action.validate();
    if (!validationResult.ok) {
      await interaction.reply(getErrorMessage("Error", validationResult.val));
      return;
    }

    // defer: fetches every target, then DMs and runs the action REST call for each one
    await interaction.deferReply();

    // Command option uploads are ephemeral and get deleted, so the response
    // re-hosts the file and the cases keep that copy.
    const download = options.attachment
      ? this.downloadAttachment(
          options.attachment,
          interaction.attachmentSizeLimit,
        )
      : Promise.resolve(null);

    const targetsResult =
      await this.targetResolutionService.fetchTargets(interaction);
    if (!targetsResult.ok) {
      const editMsg = getErrorMessageEdit("Error", targetsResult.val);
      await interaction.editReply(editMsg);
      return;
    }

    const targets = targetsResult.val;
    const executeResults = await this.moderationService.executeAction(
      action,
      targets,
    );

    // Get guild config for displaying configured DM messages
    const guildConfig = await this.guildConfigRepository.findByGuildId(
      action.guildId,
    );

    const cases = executeResults.flatMap((r) => (r.ok ? [r.val] : []));
    const template = expansion?.template ?? null;
    const savePrompt =
      cases.length > 0 &&
      !template &&
      this.config.actionType !== ActionType.Note &&
      (await this.promptSave(action.guildId, options.reason?.value ?? null));

    const upload = cases.length > 0 ? await download : null;

    const reasonNotes = this.reasonNotes(expansion, cases, emojis);
    const buildMessage = (uploadName: string | null) =>
      buildActionResultMessage({
      actionType: this.config.actionType,
      executor: interaction.user,
      targets,
      results: executeResults,
      guildConfig: guildConfig || GuildConfig.createDefault(action.guildId),
      action,
      emojis,
      reasonNotes,
      savePrompt,
      upload: uploadName,
    });

    if (template && cases.length > 0) {
      await this.recordTemplateUse(action.guildId, template.id);
    }

    const reply = upload
      ? await this.replyWithUpload(interaction, buildMessage, upload)
      : null;
    if (reply) {
      await this.saveUploadedAttachment(reply, action.guildId, cases);
    } else {
      await interaction.editReply(buildMessage(null));
    }

    if (savePrompt) {
      this.metrics.recordSavePrompt("shown");
    }

    if (cases.length > 0) {
      this.scheduleExpiry(interaction, this.logger);
    }
  }

  /** Only media is re-hosted: a gallery is the one place its link keeps working. */
  private async downloadAttachment(
    attachment: Attachment,
    sizeLimit: number,
  ): Promise<UploadFile | null> {
    if (
      !isGalleryMedia(attachment.name) ||
      attachment.size > Math.min(sizeLimit, ATTACHMENT_REHOST_MAX_BYTES)
    ) {
      return null;
    }

    try {
      const res = await fetch(attachment.url, {
        signal: AbortSignal.timeout(ATTACHMENT_DOWNLOAD_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(
          { status: res.status, attachmentId: attachment.id },
          "Failed to download case attachment",
        );
        return null;
      }
      return {
        name: safeAttachmentName(attachment.name),
        data: Buffer.from(await res.arrayBuffer()),
      };
    } catch (err) {
      this.logger.warn(
        { err, attachmentId: attachment.id },
        "Failed to download case attachment",
      );
      return null;
    }
  }

  /**
   * The action already happened, so a failed upload falls back to the
   * response without it instead of the router's error box. null on failure.
   */
  private async replyWithUpload(
    interaction: ChatInputCommandInteraction<"cached">,
    buildMessage: (uploadName: string | null) => ActionResponseMessage,
    upload: UploadFile,
  ): Promise<Message | null> {
    try {
      return await interaction.editReply({
        ...buildMessage(upload.name),
        files: [new AttachmentBuilder(upload.data, { name: upload.name })],
      });
    } catch (err) {
      this.logger.warn(
        { err, guildId: interaction.guildId },
        "Failed to upload case attachment with the response",
      );
      return null;
    }
  }

  private async saveUploadedAttachment(
    reply: Message,
    guildId: string,
    cases: ModerationCase[],
  ): Promise<void> {
    const uploaded = reply.attachments.first();
    if (!uploaded) {
      this.logger.warn(
        { guildId, messageId: reply.id },
        "Response is missing the re-uploaded case attachment",
      );
      return;
    }

    const caseIds = cases.map((c) => c.caseId);
    try {
      await this.moderationService.replaceAttachments(guildId, caseIds, [
        uploaded.url,
      ]);
    } catch (err) {
      this.logger.warn(
        { err, guildId, caseIds },
        "Failed to save re-uploaded case attachment",
      );
    }
  }

  // The action already happened, so these never fail the deferred reply; the
  // router would overwrite it with an error box.
  private async promptSave(
    guildId: string,
    reason: string | null,
  ): Promise<boolean> {
    try {
      return await this.reasonTemplateService.shouldPromptSave(guildId, reason);
    } catch (err) {
      this.logger.warn({ err, guildId }, "Failed to check the save prompt");
      return false;
    }
  }

  private async recordTemplateUse(
    guildId: string,
    templateId: string,
  ): Promise<void> {
    try {
      await this.reasonTemplateService.recordUse(guildId, templateId);
    } catch (err) {
      this.logger.warn(
        { err, guildId, templateId },
        "Failed to record template use",
      );
    }
  }

  private reasonNotes(
    expansion: ExpandResult | null,
    cases: ModerationCase[],
    emojis: ModerationActionEmojis,
  ): string[] {
    const notes: string[] = [];
    if (expansion?.template) {
      notes.push(templateNote(expansion.template));
    }
    if (expansion?.unknownShortcut) {
      notes.push(
        unknownShortcutNote(
          expansion.unknownShortcut,
          emojis,
          cases.some((c) => c.dmSuccess),
        ),
      );
    }
    return notes;
  }
}
