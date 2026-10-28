import type {
  ButtonInteraction,
  Client,
  Message,
  ModalMessageModalSubmitInteraction,
  User,
} from "discord.js";
import { Routes } from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { ModerationCase } from "../domain/entities/ModerationCase";
import type { ModLogRepository } from "../domain/repositories/ModLogRepository";
import {
  MOD_LOG_EMOJIS,
  type ModLogMessage,
  type ModLogMessageInput,
  type ModLogTarget,
  buildLegacyConversionBody,
  buildModLogMessage,
  extractFactsBlock,
  extractLegacyFacts,
  isLegacyEntry,
  isLegacyEntryWithDeletedDm,
} from "../presentation/views/ModLogMessageView";

export type ModLogRenderOptions = Pick<
  ModLogMessageInput,
  "timeoutChange" | "confirmDeleteDm"
> & {
  /** Skips the user fetch when the caller already has the target. */
  targetUser?: User;
  /** The posted entry being replaced, so facts the row can't rebuild are kept. */
  currentMessage?: Message | null;
};

/**
 * - `updated`: the mod log message was edited
 * - `pending`: no message yet; the audit log post will render the current row
 * - `no_message`: the case was never posted (mod log was off at the time)
 * - `not_configured`: the guild has no mod log channel now
 * - `failed`: the channel or message couldn't be fetched or edited
 */
export type ModLogRefreshOutcome =
  | "updated"
  | "pending"
  | "no_message"
  | "not_configured"
  | "failed";

/** A case with its posted mod log message, or why there's none. */
export interface ModLogEntry {
  /** Synced with what a legacy entry shows (see syncLegacyDeletedDm). */
  moderationCase: ModerationCase;
  message: Message | null;
  /** Set when message is null. */
  missing: Exclude<ModLogRefreshOutcome, "updated"> | null;
}

type MessageInteraction =
  | ButtonInteraction<"cached">
  | ModalMessageModalSubmitInteraction<"cached">;

function defaultAvatarURL(userId: string): string {
  let index = 0n;
  try {
    index = (BigInt(userId) >> 22n) % 6n;
  } catch {
    // Non-numeric IDs only appear in tests and fixtures; the first default avatar is fine.
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/**
 * Renders mod log entries from a case and keeps posted entries in sync with
 * the database row. Every edit goes through here so legacy embed entries are
 * converted the same way.
 */
export class ModLogMessageService {
  constructor(
    private readonly client: Client,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly emojiRepository: BotEmojiRepository,
    private readonly modLogRepository: Pick<ModLogRepository, "markDmDeleted">,
    private readonly logger: Logger,
  ) {}

  async render(
    moderationCase: ModerationCase,
    options: ModLogRenderOptions = {},
  ): Promise<ModLogMessage> {
    const { targetUser, currentMessage, ...viewOptions } = options;
    const executorId = moderationCase.executorId ?? this.client.user?.id;

    const [target, executorTag, emojis] = await Promise.all([
      this.resolveTarget(moderationCase, targetUser),
      executorId ? this.resolveTag(executorId) : Promise.resolve(null),
      this.emojiRepository.getEmojis(MOD_LOG_EMOJIS),
    ]);

    let factsBlock: string | null = null;
    let extraFacts: string[] = [];
    if (currentMessage) {
      const json = currentMessage.toJSON() as Parameters<
        typeof extractFactsBlock
      >[0];
      if (isLegacyEntry(currentMessage)) {
        extraFacts = extractLegacyFacts(json, moderationCase);
      } else {
        factsBlock = extractFactsBlock(json);
      }
    }

    return buildModLogMessage({
      moderationCase,
      target,
      emojis,
      fallbackExecutorId: this.client.user?.id ?? null,
      executorTag,
      factsBlock,
      extraFacts,
      ...viewOptions,
    });
  }

  /**
   * Embed entries from before components v2 marked a deleted DM only on the
   * message. Stores it, so neither a re-render nor a DM edit treats the DM
   * as live.
   */
  async syncLegacyDeletedDm(
    moderationCase: ModerationCase,
    message: Message | null,
  ): Promise<ModerationCase> {
    if (
      moderationCase.dmDeleted ||
      !message ||
      !isLegacyEntryWithDeletedDm(message)
    ) {
      return moderationCase;
    }

    await this.modLogRepository.markDmDeleted(
      moderationCase.guildId,
      moderationCase.caseId,
      null,
      null,
    );
    return moderationCase.withDmDeleted();
  }

  /** Fetches the case's posted entry and syncs a legacy DM deletion. */
  async loadEntry(moderationCase: ModerationCase): Promise<ModLogEntry> {
    if (!moderationCase.msgId) {
      return {
        moderationCase,
        message: null,
        missing: moderationCase.pending ? "pending" : "no_message",
      };
    }

    const config = await this.guildConfigRepository.findByGuildId(
      moderationCase.guildId,
    );
    const channelId = config.loggingSettings.modLogChannel;
    if (!channelId || !config.loggingSettings.modLogEnabled) {
      return { moderationCase, message: null, missing: "not_configured" };
    }

    let message: Message;
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel?.isTextBased()) {
        this.logger.warn(
          { guildId: moderationCase.guildId, channelId },
          "Mod log channel is missing or not text-based",
        );
        return { moderationCase, message: null, missing: "failed" };
      }
      message = await channel.messages.fetch(moderationCase.msgId);
    } catch (err) {
      this.logger.warn(
        {
          err,
          guildId: moderationCase.guildId,
          caseId: moderationCase.caseId,
          channelId,
          messageId: moderationCase.msgId,
        },
        "Failed to fetch mod log message",
      );
      return { moderationCase, message: null, missing: "failed" };
    }

    return {
      moderationCase: await this.syncLegacyDeletedDm(moderationCase, message),
      message,
      missing: null,
    };
  }

  /**
   * Re-renders a loaded entry. Pass the entry's case or a newer copy of it.
   * Best effort: failures are logged and returned, never thrown.
   */
  async refreshEntry(
    entry: Pick<ModLogEntry, "message" | "missing">,
    moderationCase: ModerationCase,
    options: Omit<ModLogRenderOptions, "currentMessage"> = {},
  ): Promise<ModLogRefreshOutcome> {
    if (!entry.message) {
      return entry.missing ?? "no_message";
    }

    const message = entry.message;
    const rendered = await this.render(moderationCase, {
      ...options,
      currentMessage: message,
    });

    try {
      if (isLegacyEntry(message)) {
        await this.convertLegacyEntry(
          message.channelId,
          message.id,
          message.flags.bitfield,
          rendered,
        );
      } else {
        await message.edit(rendered);
      }
      return "updated";
    } catch (err) {
      this.logger.warn(
        {
          err,
          guildId: moderationCase.guildId,
          caseId: moderationCase.caseId,
          messageId: message.id,
        },
        "Failed to update mod log message",
      );
      return "failed";
    }
  }

  /** loadEntry then refreshEntry. Best effort, never throws for Discord failures. */
  async refresh(
    moderationCase: ModerationCase,
    options: Omit<ModLogRenderOptions, "currentMessage"> = {},
  ): Promise<ModLogRefreshOutcome> {
    const entry = await this.loadEntry(moderationCase);
    return this.refreshEntry(entry, entry.moderationCase, options);
  }

  /**
   * Responds to a button or form on the entry by replacing it. A legacy entry
   * is acknowledged and converted over REST.
   *
   * Returns "failed" when that conversion fails. It's logged, not thrown: the
   * interaction is already acknowledged, and an error reply from the router
   * would overwrite the entry itself. The caller tells the mod privately.
   */
  async updateFromInteraction(
    interaction: MessageInteraction,
    message: ModLogMessage,
  ): Promise<"updated" | "failed"> {
    const posted = interaction.message;
    if (!isLegacyEntry(posted)) {
      await interaction.update(message);
      return "updated";
    }

    // defer: ack-only, the legacy embed is converted over REST because discord.js can't send content: null
    await interaction.deferUpdate();
    try {
      await this.convertLegacyEntry(
        posted.channelId,
        posted.id,
        posted.flags.bitfield,
        message,
      );
      return "updated";
    } catch (err) {
      this.logger.warn(
        { err, messageId: posted.id, channelId: posted.channelId },
        "Failed to convert legacy mod log entry",
      );
      return "failed";
    }
  }

  async convertLegacyEntry(
    channelId: string,
    messageId: string,
    existingFlags: number,
    message: ModLogMessage,
  ): Promise<void> {
    await this.client.rest.patch(Routes.channelMessage(channelId, messageId), {
      body: buildLegacyConversionBody(message, existingFlags),
    });
  }

  private async resolveUser(userId: string): Promise<User | null> {
    const cached = this.client.users.cache.get(userId);
    if (cached) {
      return cached;
    }

    try {
      return await this.client.users.fetch(userId);
    } catch (err) {
      // The entry still renders from stored data; only the avatar or tag is lost.
      this.logger.warn({ err, userId }, "Failed to fetch mod log user");
      return null;
    }
  }

  private async resolveTag(userId: string): Promise<string | null> {
    return (await this.resolveUser(userId))?.tag ?? null;
  }

  /** Keeps the name the case recorded; deleted accounts lose theirs on Discord. */
  private async resolveTarget(
    moderationCase: ModerationCase,
    known: User | undefined,
  ): Promise<ModLogTarget> {
    const user = known ?? (await this.resolveUser(moderationCase.userId));

    return {
      id: moderationCase.userId,
      username: moderationCase.userTag || user?.tag || moderationCase.userId,
      avatarURL:
        user?.displayAvatarURL?.() ?? defaultAvatarURL(moderationCase.userId),
    };
  }
}
