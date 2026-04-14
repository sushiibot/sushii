import {
  ChannelType,
  ChatInputCommandInteraction,
  ContainerBuilder,
  LabelBuilder,
  ChannelSelectMenuBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
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

const MODAL_CUSTOM_ID = "schedule-config/new";

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
        .setName("new")
        .setDescription("Configure a schedule channel to sync a Google Calendar."),
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
      case "new":
        return this.handleAdd(interaction);
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

  private async handleAdd(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command can only be used in a server.", flags: MessageFlags.Ephemeral });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(MODAL_CUSTOM_ID)
      .setTitle("Add Schedule Channel")
      .addComponents(
        new LabelBuilder()
          .setLabel("Schedule name")
          .setDescription("Shown in the channel header (e.g. 'BLACKPINK Schedule')")
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId("name")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder("e.g. BLACKPINK Schedule"),
          ),
        new LabelBuilder()
          .setLabel("Google Calendar URL or ID")
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId("calendar")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder("https://calendar.google.com/calendar/embed?src=..."),
          ),
        new LabelBuilder()
          .setLabel("Schedule channel")
          .setDescription("The channel to post the schedule in")
          .setChannelSelectMenuComponent(
            new ChannelSelectMenuBuilder()
              .setCustomId("channel")
              .addChannelTypes(ChannelType.GuildText),
          ),
        new LabelBuilder()
          .setLabel("Log channel")
          .setDescription("Channel for event change notifications and error alerts")
          .setChannelSelectMenuComponent(
            new ChannelSelectMenuBuilder()
              .setCustomId("log-channel")
              .addChannelTypes(ChannelType.GuildText),
          ),
      );

    await interaction.showModal(modal);

    let submit;
    try {
      submit = await interaction.awaitModalSubmit({ time: 5 * 60 * 1000 });
    } catch {
      // User dismissed the modal or it timed out — nothing to do
      return;
    }

    if (!submit.guildId) {
      await submit.reply({ content: "This command can only be used in a server.", flags: MessageFlags.Ephemeral });
      return;
    }

    const title = submit.fields.getTextInputValue("name");
    const calendarInput = submit.fields.getTextInputValue("calendar");

    const channels = submit.fields.getSelectedChannels("channel", true, [ChannelType.GuildText]);
    const logChannels = submit.fields.getSelectedChannels("log-channel", true, [ChannelType.GuildText]);

    const channel = channels?.first();
    const logChannel = logChannels?.first();

    if (!channel || !logChannel) {
      const emojis = await this.emojiRepo.getEmojis(CONFIG_EMOJI_NAMES);
      await submit.reply(makeContainer(`${emojis.fail} Please select both a schedule channel and a log channel.`));
      return;
    }

    const result = await this.scheduleChannelService.configure({
      guildId: BigInt(submit.guildId),
      channelId: BigInt(channel.id),
      logChannelId: BigInt(logChannel.id),
      configuredByUserId: BigInt(submit.user.id),
      calendarInput,
      title,
    });

    const emojis = await this.emojiRepo.getEmojis(CONFIG_EMOJI_NAMES);

    if (result.err) {
      await submit.reply(makeContainer(`${emojis.fail} ${result.val}`));
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

    await submit.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });

    // Post confirmation to log channel (best-effort — never fail the command reply)
    try {
      const fetchedLogChannel = await submit.client.channels.fetch(sc.logChannelId.toString());
      if (fetchedLogChannel?.isTextBased() && !fetchedLogChannel.isDMBased()) {
        const logContainer = new ContainerBuilder()
          .setAccentColor(Color.Success)
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `${emojis.success} Schedule channel configured: <#${sc.channelId}> — ${sc.displayTitle} — will now sync ${intervalDisplay}.`,
            ),
          );
        await fetchedLogChannel.send({
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
