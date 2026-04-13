import {
  ChannelType,
  ChatInputCommandInteraction,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextDisplayBuilder,
  time,
  TimestampStyles,
} from "discord.js";
import type { Logger } from "pino";

import { SlashCommandHandler } from "@/shared/presentation/handlers";

import { formatPollInterval } from "../../application/ScheduleChannelService";
import type { ScheduleChannelService } from "../../application/ScheduleChannelService";

function errorContainer(message: string): { components: ContainerBuilder[]; flags: number } {
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(message),
  );
  return {
    components: [container],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  };
}

export class ScheduleCommand extends SlashCommandHandler {
  serverOnly = true;

  command = new SlashCommandBuilder()
    .setName("schedule")
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
            .setName("title")
            .setDescription("Display title shown above the schedule. If omitted, only the month and year are shown.")
            .setRequired(false),
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

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = interaction.options.getChannel("channel", true);
    const logChannel = interaction.options.getChannel("log-channel", true);
    const calendarInput = interaction.options.getString("calendar", true);
    const title = interaction.options.getString("title") ?? undefined;

    const result = await this.scheduleChannelService.configure({
      guildId: BigInt(interaction.guildId),
      channelId: BigInt(channel.id),
      logChannelId: BigInt(logChannel.id),
      configuredByUserId: BigInt(interaction.user.id),
      calendarInput,
      title,
    });

    if (result.err) {
      await interaction.editReply(errorContainer(`❌ ${result.val}`));
      return;
    }

    const sc = result.val;
    const displayTitleText = sc.displayTitle ?? "(month/year only)";
    const intervalDisplay = formatPollInterval(sc.pollIntervalSec);

    const content = [
      "✅ **Schedule channel configured!**",
      "",
      `**Channel:** <#${sc.channelId}>`,
      `**Log channel:** <#${sc.logChannelId}>`,
      `**Calendar:** ${sc.calendarTitle}`,
      `**Schedule title:** ${displayTitleText}`,
      "",
      `-# Syncing ${intervalDisplay}`,
    ].join("\n");

    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(content),
    );

    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  private async handleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command can only be used in a server.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = interaction.options.getChannel("channel", true);

    const result = await this.scheduleChannelService.remove(
      BigInt(interaction.guildId),
      BigInt(channel.id),
    );

    if (result.err) {
      await interaction.editReply(errorContainer(`❌ ${result.val}`));
      return;
    }

    const content = [
      "✅ **Schedule channel removed**",
      "",
      `Configuration for <#${channel.id}> has been deleted. Existing messages in the channel have been left intact.`,
    ].join("\n");

    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(content),
    );

    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  private async handleList(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command can only be used in a server.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channels = await this.scheduleChannelService.listForGuild(BigInt(interaction.guildId));

    if (channels.length === 0) {
      const emptyContainer = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("No schedule channels are configured in this server."),
      );
      await interaction.editReply({
        components: [emptyContainer],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    const container = new ContainerBuilder();
    const lines: string[] = ["**Configured Schedule Channels**\n"];

    for (const sc of channels) {
      lines.push(`**<#${sc.channelId}>**`);
      if (sc.displayTitle) {
        lines.push(`🏷️ Title: ${sc.displayTitle}`);
      }
      lines.push(`📅 ${sc.calendarTitle}`);
      lines.push(`-# Calendar ID: ${sc.calendarId}`);
      lines.push(`🔔 Log channel: <#${sc.logChannelId}>`);
      lines.push(`🔄 Next sync: ${time(sc.nextPollAt, TimestampStyles.RelativeTime)}`);
      if (sc.consecutiveFailures > 0) {
        const failureLine = sc.lastErrorReason
          ? `⚠️ Failing (${sc.consecutiveFailures} consecutive failures) — last error: ${sc.lastErrorReason}`
          : `⚠️ Failing (${sc.consecutiveFailures} consecutive failures)`;
        lines.push(failureLine);
      }
      lines.push("");
    }

    const content = lines.join("\n").trimEnd();
    const truncated = content.length > 4000
      ? content.slice(0, 4000) + "\n…(truncated)"
      : content;
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(truncated),
    );

    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  private async handleRefresh(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command can only be used in a server.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = interaction.options.getChannel("channel", true);

    const result = await this.scheduleChannelService.refresh(
      BigInt(interaction.guildId),
      BigInt(channel.id),
    );

    if (result.err) {
      await interaction.editReply(errorContainer(`❌ ${result.val}`));
      return;
    }

    const content = [
      `✅ **Resync queued for <#${channel.id}>**`,
      "",
      "-# The schedule channel will update at the next poll.",
    ].join("\n");

    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(content),
    );

    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}
