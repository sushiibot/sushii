import {
  ButtonInteraction,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from "discord.js";
import { match } from "path-to-regexp";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";
import ButtonHandler from "@/shared/presentation/handlers/ButtonHandler";
import Color from "@/utils/colors";

import type { ScheduleChannelService } from "../../application/ScheduleChannelService";
import {
  makeContainer,
  SCHEDULE_CONFIG_CUSTOM_IDS,
  SCHEDULE_CONFIG_EMOJI_NAMES,
} from "../ScheduleConfigConstants";

export class ScheduleConfigDeleteButtonHandler extends ButtonHandler {
  readonly customIDMatch = match(SCHEDULE_CONFIG_CUSTOM_IDS.DELETE_MATCH_PATTERN);

  constructor(
    private readonly scheduleChannelService: ScheduleChannelService,
    private readonly logger: Logger,
    private readonly emojiRepo: BotEmojiRepository,
  ) {
    super();
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const invokerId = interaction.message.interactionMetadata?.user.id;
    if (invokerId && interaction.user.id !== invokerId) {
      await interaction.reply({
        content: "Only the user who ran this command can use this button.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const matchResult = this.customIDMatch(interaction.customId);
    if (!matchResult) {
      return;
    }

    const { action, channelId } = matchResult.params as { action: string; channelId?: string };

    if (action === "cancel") {
      await interaction.deferUpdate();
      await interaction.deleteReply();
      return;
    }

    if (action === "confirm" && channelId) {
      await this.handleConfirm(interaction, channelId);
    } else {
      this.logger.warn({ action, channelId, customId: interaction.customId }, "Unrecognized delete button action or missing channelId");
      await interaction.deferUpdate();
      await interaction.deleteReply();
    }
  }

  private async handleConfirm(interaction: ButtonInteraction, channelIdStr: string): Promise<void> {
    const guildId = BigInt(interaction.guildId!);
    const channelId = BigInt(channelIdStr);
    const emojis = await this.emojiRepo.getEmojis(SCHEDULE_CONFIG_EMOJI_NAMES);

    // Fetch details before deleting so we have them for the public confirmation message.
    const schedule = await this.scheduleChannelService.getByChannel(guildId, channelId);

    await interaction.deferUpdate();

    const result = await this.scheduleChannelService.remove(guildId, channelId);

    if (result.err) {
      await interaction.editReply(makeContainer(`${emojis.fail} ${result.val}`, Color.Error));
      return;
    }

    // Update the ephemeral confirmation to acknowledge the action.
    const ephemeralLine = schedule
      ? `${emojis.success} **Deleted** — **${schedule.displayTitle}** (was posting to <#${channelIdStr}>)`
      : `${emojis.success} **Schedule deleted.**`;

    await interaction.editReply(makeContainer(ephemeralLine, Color.Success));

    // Send a non-ephemeral message to the channel for visibility.
    if (!interaction.channel?.isTextBased() || interaction.channel.isDMBased()) {
      return;
    }

    const lines: string[] = [`${emojis.success} **Schedule deleted**`];

    if (schedule) {
      lines.push(
        "",
        `**Name:** ${schedule.displayTitle}`,
        `**Channel:** <#${channelIdStr}>`,
        `**Google Calendar:** ${schedule.calendarTitle}`,
      );
    }

    lines.push(
      "",
      `-# Existing posts in <#${channelIdStr}> were not deleted — they stay as-is.`,
      `-# No Google Calendar events were removed — your calendar is unchanged.`,
      "",
      "To add a new calendar, use `/schedule-config new`.",
      `To view remaining schedules, use \`/schedule-config list\`.`,
    );

    const container = new ContainerBuilder()
      .setAccentColor(Color.Success)
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n")));

    try {
      await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      this.logger.warn(
        { err, channelId: channelIdStr },
        "Failed to send public schedule deletion confirmation to channel",
      );
    }
  }
}
