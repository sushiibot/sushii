import {
  ChannelType,
  ChatInputCommandInteraction,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder,
  time,
  TimestampStyles,
} from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";
import { SlashCommandHandler } from "@/shared/presentation/handlers";
import Color from "@/utils/colors";

import { formatPollInterval } from "../../application/ScheduleChannelService";
import type { ScheduleChannelService } from "../../application/ScheduleChannelService";

const CONFIG_EMOJI_NAMES = ["success", "fail", "warning", "schedule", "bell"] as const;

function makeContainer(
  message: string,
  color = Color.Error,
): { components: ContainerBuilder[]; flags: number } {
  const container = new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(message));
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

export class ScheduleConfigCommand extends SlashCommandHandler {
  serverOnly = true;

  command = new SlashCommandBuilder()
    .setName("schedule-config")
    .setDescription("Configure and manage schedule channels synced from Google Calendar.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((c) =>
      c
        .setName("set")
        .setDescription("Configure a schedule channel to sync a Google Calendar.")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("The channel to post the schedule in.")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        )
        .addChannelOption((o) =>
          o
            .setName("log-channel")
            .setDescription("The channel for event change notifications and error alerts.")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("calendar")
            .setDescription("Google Calendar URL or calendar ID.")
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("Schedule name shown in the Discord channel (e.g. 'BLACKPINK Schedule').")
            .setRequired(true),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName("remove")
        .setDescription("Remove a schedule channel configuration.")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("The schedule channel to remove.")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName("list")
        .setDescription("List all configured schedule channels in this server."),
    )
    .addSubcommand((c) =>
      c
        .setName("refresh")
        .setDescription("Force an immediate full resync of a schedule channel.")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("The schedule channel to refresh.")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .toJSON();

  constructor(
    private readonly scheduleChannelService: ScheduleChannelService,
    private readonly logger: Logger,
    private readonly emojiRepo: BotEmojiRepository,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case "set":
        return this.handleSet(interaction);
      case "remove":
        return this.handleRemove(interaction);
      case "list":
        return this.handleList(interaction);
      case "refresh":
        return this.handleRefresh(interaction);
      default:
        throw new Error(`Unknown subcommand: ${subcommand}`);
    }
  }

  private async handleSet(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command can only be used in a server.", flags: MessageFlags.Ephemeral });
      return;
    }

    const channel = interaction.options.getChannel("channel", true);
    const logChannel = interaction.options.getChannel("log-channel", true);
    const calendarInput = interaction.options.getString("calendar", true);
    const title = interaction.options.getString("name", true);

    const result = await this.scheduleChannelService.configure({
      guildId: BigInt(interaction.guildId),
      channelId: BigInt(channel.id),
      logChannelId: BigInt(logChannel.id),
      configuredByUserId: BigInt(interaction.user.id),
      calendarInput,
      title,
    });

    const emojis = await this.emojiRepo.getEmojis(CONFIG_EMOJI_NAMES);

    if (result.err) {
      await interaction.reply(makeContainer(`${emojis.fail} ${result.val}`));
      return;
    }

    const sc = result.val;
    const intervalDisplay = formatPollInterval(sc.pollIntervalSec);

    const content = [
      `${emojis.success} **Schedule channel configured**`,
      "",
      `**Channel:** <#${sc.channelId}>`,
      `**Log channel:** <#${sc.logChannelId}>`,
      `**Name:** ${sc.displayTitle}`,
      `-# ${sc.calendarTitle}  ·  Syncs ${intervalDisplay}`,
    ].join("\n");

    const container = new ContainerBuilder()
      .setAccentColor(Color.Success)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });

    // Post confirmation to log channel (best-effort — never fail the command reply)
    try {
      const logChannel = await interaction.client.channels.fetch(sc.logChannelId.toString());
      if (logChannel?.isTextBased() && !logChannel.isDMBased()) {
        const logContainer = new ContainerBuilder()
          .setAccentColor(Color.Success)
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `${emojis.success} Schedule channel configured: <#${sc.channelId}> — ${sc.displayTitle} — will now sync ${intervalDisplay}.`,
            ),
          );
        await logChannel.send({
          components: [logContainer],
          flags: MessageFlags.IsComponentsV2,
        });
      }
    } catch (err) {
      this.logger.warn(
        { err, logChannelId: sc.logChannelId.toString() },
        "Failed to post configuration confirmation to log channel",
      );
    }
  }

  private async handleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command can only be used in a server.", flags: MessageFlags.Ephemeral });
      return;
    }

    const channel = interaction.options.getChannel("channel", true);

    const emojis = await this.emojiRepo.getEmojis(CONFIG_EMOJI_NAMES);

    const result = await this.scheduleChannelService.remove(
      BigInt(interaction.guildId),
      BigInt(channel.id),
    );

    if (result.err) {
      await interaction.reply(makeContainer(`${emojis.fail} ${result.val}`));
      return;
    }

    const content = [
      `${emojis.success} **Schedule channel removed**`,
      "",
      `Configuration for <#${channel.id}> has been deleted. Existing messages in the channel have been left intact.`,
    ].join("\n");

    const container = new ContainerBuilder()
      .setAccentColor(Color.Success)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  private async handleList(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command can only be used in a server.", flags: MessageFlags.Ephemeral });
      return;
    }

    const emojis = await this.emojiRepo.getEmojis(CONFIG_EMOJI_NAMES);

    const channels = await this.scheduleChannelService.listForGuild(BigInt(interaction.guildId));

    if (channels.length === 0) {
      await interaction.reply(makeContainer("No schedule channels are configured in this server.", Color.Info));
      return;
    }

    const container = new ContainerBuilder().setAccentColor(Color.Info);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Schedule Channels"));
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
    );

    for (let i = 0; i < channels.length; i++) {
      const sc = channels[i];

      const lines: string[] = [
        `${emojis.schedule} **<#${sc.channelId}>**${sc.displayTitle ? ` — ${sc.displayTitle}` : ""}`,
        `-# ${sc.calendarTitle}  ·  ${emojis.bell} <#${sc.logChannelId}>  ·  Syncs ${time(sc.nextPollAt, TimestampStyles.RelativeTime)}`,
      ];

      if (sc.consecutiveFailures > 0) {
        const failureLine = sc.lastErrorReason
          ? `${emojis.warning} ${sc.consecutiveFailures} consecutive failures — ${sc.lastErrorReason}`
          : `${emojis.warning} ${sc.consecutiveFailures} consecutive failures`;
        lines.push(failureLine);
      }

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(lines.join("\n")),
      );

      if (i < channels.length - 1) {
        container.addSeparatorComponents(
          new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
        );
      }
    }

    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  private async handleRefresh(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command can only be used in a server.", flags: MessageFlags.Ephemeral });
      return;
    }

    const channel = interaction.options.getChannel("channel", true);

    const emojis = await this.emojiRepo.getEmojis(CONFIG_EMOJI_NAMES);

    const result = await this.scheduleChannelService.refresh(
      BigInt(interaction.guildId),
      BigInt(channel.id),
    );

    if (result.err) {
      await interaction.reply(makeContainer(`${emojis.fail} ${result.val}`));
      return;
    }

    const content = [
      `${emojis.success} **Refresh queued for <#${channel.id}>**`,
      "",
      "-# The channel will update within a minute.",
    ].join("\n");

    const container = new ContainerBuilder()
      .setAccentColor(Color.Success)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}
