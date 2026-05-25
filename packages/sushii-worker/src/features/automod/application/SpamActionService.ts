import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  DiscordAPIError,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  RESTJSONErrorCodes,
  SeparatorBuilder,
  TextDisplayBuilder,
  type Client,
  type Guild,
  type GuildMember,
} from "discord.js";
import type { Logger } from "pino";

import Color from "@/utils/colors";
import customIds from "@/interactions/customIds";

import { SpamDetectionService } from "./SpamDetectionService";
import type { SpamAlertCache } from "./SpamAlertCache";

interface SpamAttachment {
  filename: string;
  url: string;
  contentType?: string;
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".apng"]);

function isImageAttachment(attachment: SpamAttachment): boolean {
  if (attachment.contentType?.startsWith("image/")) {
    return true;
  }
  const dot = attachment.filename.lastIndexOf(".");
  if (dot === -1) {
    return false;
  }
  const ext = attachment.filename.slice(dot).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

// Timeout duration applied to spam offenders
const SPAM_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export class SpamActionService {
  constructor(
    private readonly client: Client,
    private readonly spamAlertCache: SpamAlertCache,
    private readonly logger: Logger,
  ) {}

  async executeSpamAction(
    guildId: string,
    userId: string,
    username: string,
    spamMessages: Map<string, string[]>,
    spamContent: string | null,
    spamAttachments: SpamAttachment[],
    alertsChannelId?: string | null,
  ): Promise<void> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      this.logger.warn({ guildId }, "Guild not found in cache for spam action");
      return;
    }

    const channelCount = spamMessages.size;
    let detectedMessageCount = 0;
    for (const ids of spamMessages.values()) {
      detectedMessageCount += ids.length;
    }

    // Let API errors throw — only treat a missing member as a soft failure
    const member = await guild.members.fetch(userId).catch((err: unknown) => {
      if (
        err instanceof DiscordAPIError &&
        err.code === RESTJSONErrorCodes.UnknownMember
      ) {
        return null;
      }
      throw err;
    });

    const reason = `[AutoMod] Spam: same message sent to ${channelCount} channels within ${SpamDetectionService.SPAM_WINDOW_MS / 1000} seconds`;

    await this.applySpamTimeout(
      member,
      guildId,
      userId,
      username,
      channelCount,
      detectedMessageCount,
      reason,
    );

    // Must send alert before deleting — once source messages are deleted, all attachment
    // URLs (gallery images and file links) become invalid.
    if (alertsChannelId) {
      try {
        await this.sendSpamAlert(
          guild,
          alertsChannelId,
          userId,
          username,
          channelCount,
          detectedMessageCount,
          spamContent,
          spamAttachments,
        );
      } catch (err: unknown) {
        this.logger.warn(
          { err, guildId, userId, alertsChannelId },
          "Failed to send automod alert",
        );
      }
    }

    const deleteResults = await Promise.allSettled(
      Array.from(spamMessages.entries()).map(([channelId, messageIds]) =>
        this.bulkDeleteSpamMessages(guild, channelId, messageIds),
      ),
    );

    for (const result of deleteResults) {
      if (result.status === "rejected") {
        this.logger.warn(
          { err: result.reason, guildId, userId },
          "Failed to delete spam messages",
        );
      }
    }

    // After timeout lands, sweep the same channels for any matching messages
    // from this user that arrived during the timeout window
    await this.sweepRemainingSpamMessages(
      guild,
      guildId,
      userId,
      spamMessages,
      spamContent,
    );
  }

  private async applySpamTimeout(
    member: GuildMember | null,
    guildId: string,
    userId: string,
    username: string,
    channelCount: number,
    detectedMessageCount: number,
    reason: string,
  ): Promise<void> {
    if (!member) {
      this.logger.warn(
        { guildId, userId },
        "Member not found, skipping timeout",
      );
      return;
    }

    if (!member.moderatable) {
      this.logger.info(
        { guildId, userId },
        "Member is not moderatable, skipping timeout",
      );
      return;
    }

    await member.timeout(SPAM_TIMEOUT_MS, reason);

    // The timeout appears in Discord's native audit log, which the audit log
    // handler picks up to create a moderation case and post to the configured
    // mod log channel automatically.
    this.logger.info(
      {
        guildId,
        userId,
        username,
        channelCount,
        detectedMessageCount,
      },
      "Applied automatic timeout for spam detection",
    );
  }

  private async sendSpamAlert(
    guild: Guild,
    alertsChannelId: string,
    userId: string,
    username: string,
    channelCount: number,
    detectedMessageCount: number,
    spamContent: string | null,
    spamAttachments: SpamAttachment[],
  ): Promise<void> {
    const channel = guild.channels.cache.get(alertsChannelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) return;

    const timeoutMinutes = SPAM_TIMEOUT_MS / 60_000;
    const summary = [
      `-# AutoMod · Spam Detection`,
      `<@${userId}> (\`${userId}\`) timed out for ${timeoutMinutes} minutes`,
      `Same message sent to ${channelCount} channels · ${detectedMessageCount} messages detected`,
    ].join("\n");

    const container = new ContainerBuilder()
      .setAccentColor(Color.Warning)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(summary));

    const imageAttachments: SpamAttachment[] = [];
    const fileAttachments: SpamAttachment[] = [];
    for (const attachment of spamAttachments) {
      if (isImageAttachment(attachment)) {
        imageAttachments.push(attachment);
      } else {
        fileAttachments.push(attachment);
      }
    }

    // Show the triggering content if available
    const contentLines: string[] = [];
    if (spamContent) {
      // Truncate to keep the alert readable
      const truncated =
        spamContent.length > 500
          ? `${spamContent.slice(0, 500)}…`
          : spamContent;
      contentLines.push(`\`\`\`\n${truncated}\n\`\`\``);
    }
    if (fileAttachments.length > 0) {
      contentLines.push(
        fileAttachments.map((attachment) => `[${attachment.filename}](${attachment.url})`).join("\n"),
      );
    }

    if (contentLines.length > 0) {
      container
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(contentLines.join("\n")),
        );
    }

    if (imageAttachments.length > 0) {
      container
        .addSeparatorComponents(new SeparatorBuilder())
        .addMediaGalleryComponents(
          new MediaGalleryBuilder().addItems(
            ...imageAttachments.map((attachment) =>
              new MediaGalleryItemBuilder()
                .setURL(attachment.url)
                .setDescription(attachment.filename),
            ),
          ),
        );
    }

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          customIds.automodAlertAction.compile({
            actionType: "warn",
            userId,
          }),
        )
        .setLabel("Warn")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(
          customIds.automodAlertAction.compile({
            actionType: "kick",
            userId,
          }),
        )
        .setLabel("Kick")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(
          customIds.automodAlertAction.compile({
            actionType: "softban",
            userId,
          }),
        )
        .setLabel("Softban")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(
          customIds.automodAlertAction.compile({
            actionType: "ban",
            userId,
          }),
        )
        .setLabel("Ban")
        .setStyle(ButtonStyle.Secondary),
    );
    container
      .addSeparatorComponents(new SeparatorBuilder())
      .addActionRowComponents(actionRow);

    const alertMessage = await channel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [], users: [] },
    });

    this.spamAlertCache.track(guild.id, userId, alertMessage.channelId, alertMessage.id);
  }

  private async sweepRemainingSpamMessages(
    guild: Guild,
    guildId: string,
    userId: string,
    spamMessages: Map<string, string[]>,
    spamContent: string | null,
  ): Promise<void> {
    const sweepResults = await Promise.allSettled(
      Array.from(spamMessages.entries()).map(([channelId, knownIds]) =>
        this.sweepChannel(guild, channelId, userId, knownIds, spamContent),
      ),
    );

    for (const result of sweepResults) {
      if (result.status === "rejected") {
        this.logger.warn(
          { err: result.reason, guildId, userId },
          "Failed to sweep remaining spam messages",
        );
      }
    }
  }

  private async sweepChannel(
    guild: Guild,
    channelId: string,
    userId: string,
    knownIds: string[],
    spamContent: string | null,
  ): Promise<void> {
    // Without content to match against, we can't reliably identify additional spam messages.
    if (spamContent === null) {
      return;
    }

    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      return;
    }

    const knownSet = new Set(knownIds);
    const recent = await channel.messages.fetch({ limit: 20 });

    const toDelete = recent
      .filter((msg) => {
        if (msg.author.id !== userId) {
          return false;
        }
        if (knownSet.has(msg.id)) {
          return false;
        }
        return msg.content === spamContent;
      })
      .map((msg) => msg.id);

    if (toDelete.length === 0) {
      return;
    }

    await this.bulkDeleteSpamMessages(guild, channelId, toDelete);

    this.logger.info(
      { guildId: guild.id, channelId, userId, count: toDelete.length },
      "Deleted additional spam messages found after timeout",
    );
  }

  private async bulkDeleteSpamMessages(
    guild: Guild,
    channelId: string,
    messageIds: string[],
  ): Promise<void> {
    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) return;

    if (messageIds.length === 1) {
      await channel.messages.delete(messageIds[0]);
    } else {
      await channel.bulkDelete(messageIds);
    }
  }
}
