import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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

import type { ScheduleChannelService } from "../../application/ScheduleChannelService";
import {
  makeContainer,
  SCHEDULE_CONFIG_CUSTOM_IDS,
  SCHEDULE_CONFIG_EMOJI_NAMES,
  SCHEDULE_CONFIG_OPTIONS,
  SCHEDULE_CONFIG_SETUP_EMOJI_NAMES,
  SCHEDULE_CONFIG_SUBCOMMANDS,
} from "../ScheduleConfigConstants";
import { ScheduleConfigEditHandler } from "../handlers/ScheduleConfigEditHandler";

export class ScheduleConfigCommand extends SlashCommandHandler {
  serverOnly = true;

  command = new SlashCommandBuilder()
    .setName("schedule-config")
    .setDescription("Configure and manage schedule channels synced from Google Calendar.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((c) =>
      c
        .setName(SCHEDULE_CONFIG_SUBCOMMANDS.NEW)
        .setDescription("Configure a schedule channel to sync a Google Calendar."),
    )
    .addSubcommand((c) =>
      c
        .setName(SCHEDULE_CONFIG_SUBCOMMANDS.EDIT)
        .setDescription("Edit the name or channels of an existing schedule.")
        .addStringOption((o) =>
          o
            .setName(SCHEDULE_CONFIG_OPTIONS.SCHEDULE)
            .setDescription("The schedule to edit.")
            .setAutocomplete(true)
            .setRequired(true),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName(SCHEDULE_CONFIG_SUBCOMMANDS.REMOVE)
        .setDescription("Remove a schedule channel configuration.")
        .addStringOption((o) =>
          o
            .setName(SCHEDULE_CONFIG_OPTIONS.SCHEDULE)
            .setDescription("The schedule channel to remove.")
            .setAutocomplete(true)
            .setRequired(true),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName(SCHEDULE_CONFIG_SUBCOMMANDS.LIST)
        .setDescription("List all configured schedule channels in this server."),
    )
    .addSubcommand((c) =>
      c
        .setName(SCHEDULE_CONFIG_SUBCOMMANDS.REFRESH)
        .setDescription("Force an immediate full resync of a schedule channel.")
        .addStringOption((o) =>
          o
            .setName(SCHEDULE_CONFIG_OPTIONS.SCHEDULE)
            .setDescription("The schedule channel to refresh.")
            .setAutocomplete(true)
            .setRequired(true),
        ),
    )
    .toJSON();

  private readonly editHandler: ScheduleConfigEditHandler;

  constructor(
    private readonly scheduleChannelService: ScheduleChannelService,
    private readonly logger: Logger,
    private readonly emojiRepo: BotEmojiRepository,
  ) {
    super();
    this.editHandler = new ScheduleConfigEditHandler(scheduleChannelService, logger, emojiRepo);
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command can only be used in a server.", flags: MessageFlags.Ephemeral });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case SCHEDULE_CONFIG_SUBCOMMANDS.NEW:
        return this.handleAdd(interaction);
      case SCHEDULE_CONFIG_SUBCOMMANDS.EDIT:
        return this.editHandler.handle(interaction);
      case SCHEDULE_CONFIG_SUBCOMMANDS.REMOVE:
        return this.handleRemove(interaction);
      case SCHEDULE_CONFIG_SUBCOMMANDS.LIST:
        return this.handleList(interaction);
      case SCHEDULE_CONFIG_SUBCOMMANDS.REFRESH:
        return this.handleRefresh(interaction);
      default:
        throw new Error(`Unknown subcommand: ${subcommand}`);
    }
  }

  private async handleAdd(interaction: ChatInputCommandInteraction): Promise<void> {
    const emojis = await this.emojiRepo.getEmojis(SCHEDULE_CONFIG_SETUP_EMOJI_NAMES);

    const container = new ContainerBuilder()
      .setAccentColor(Color.Info)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          [
            `## ${emojis.schedule} Setting Up a Schedule Channel`,
            "",
            "Your Google Calendar must be **public** before the bot can read it.",
            "We recommend creating a **new, dedicated calendar** so you don't accidentally publish personal events.",
            "",
            `${emojis.tip} **Step 1 — Create a new calendar**`,
            "Open [Google Calendar Settings](https://calendar.google.com/calendar/r/settings) and click",
            "**+ Add other → Create new calendar**. Give it a name like *Server Events*.",
            "",
            `${emojis.tip} **Step 2 — Make the calendar public**`,
            "Select your new calendar in Settings. Under **Access permissions for events**:",
            "- Check **Make available to public**",
            '- Set to **See all event details** (not "See only free/busy")',
            "",
            `${emojis.tip} **Step 3 — Copy the Calendar ID**`,
            "In that same page, scroll to **Integrate calendar** and copy the **Calendar ID**",
            "(e.g. `abc123@group.calendar.google.com`). You can also copy the **Public URL to this calendar**.",
            "",
            "-# When ready, click the button below to continue.",
          ].join("\n"),
        ),
      )
      .addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(SCHEDULE_CONFIG_CUSTOM_IDS.OPEN_MODAL_BUTTON)
            .setLabel("Set Up Schedule Channel")
            .setStyle(ButtonStyle.Primary),
        ),
      );

    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  private async handleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
    const channelId = interaction.options.getString(SCHEDULE_CONFIG_OPTIONS.SCHEDULE, true);

    const emojis = await this.emojiRepo.getEmojis(SCHEDULE_CONFIG_EMOJI_NAMES);

    const result = await this.scheduleChannelService.remove(
      BigInt(interaction.guildId!),
      BigInt(channelId),
    );

    if (result.err) {
      await interaction.reply(makeContainer(`${emojis.fail} ${result.val}`, Color.Error, true));
      return;
    }

    const content = [
      `${emojis.success} **Schedule removed**`,
      "",
      `<#${channelId}> will no longer sync with Google Calendar. Posts already in the channel were not deleted.`,
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
    const emojis = await this.emojiRepo.getEmojis(SCHEDULE_CONFIG_EMOJI_NAMES);

    const channels = await this.scheduleChannelService.listForGuild(BigInt(interaction.guildId!));

    if (channels.length === 0) {
      await interaction.reply(makeContainer("No schedule channels are configured in this server.", Color.Info));
      return;
    }

    const container = new ContainerBuilder().setAccentColor(Color.Info);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Schedule Channels"));
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
    );

    const now = Date.now();

    for (let i = 0; i < channels.length; i++) {
      const sc = channels[i];

      const nextSyncText = sc.nextPollAt.getTime() <= now
        ? "Syncing now"
        : `Next sync ${time(sc.nextPollAt, TimestampStyles.RelativeTime)}`;

      const lines: string[] = [
        `${emojis.schedule} **${sc.displayTitle}**`,
        `-# Posts to <#${sc.channelId}>  ·  Alerts to <#${sc.logChannelId}>`,
        `-# Google Calendar: ${sc.calendarTitle}  ·  ${nextSyncText}`,
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
    const channelId = interaction.options.getString(SCHEDULE_CONFIG_OPTIONS.SCHEDULE, true);

    const emojis = await this.emojiRepo.getEmojis(SCHEDULE_CONFIG_EMOJI_NAMES);

    const result = await this.scheduleChannelService.refresh(
      BigInt(interaction.guildId!),
      BigInt(channelId),
    );

    if (result.err) {
      await interaction.reply(makeContainer(`${emojis.fail} ${result.val}`, Color.Error, true));
      return;
    }

    const content = [
      `${emojis.success} **Refresh queued for <#${channelId}>**`,
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
