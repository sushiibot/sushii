import {
  ButtonInteraction,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { match } from "path-to-regexp";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";
import ButtonHandler from "@/shared/presentation/handlers/ButtonHandler";
import Color from "@/utils/colors";

import type { ScheduleChannelService } from "../../application/ScheduleChannelService";
import { formatPollInterval } from "../views/ScheduleFormatting";
import {
  makeContainer,
  SCHEDULE_CONFIG_CUSTOM_IDS,
  SCHEDULE_CONFIG_EMOJI_NAMES,
} from "../ScheduleConfigConstants";

export class ScheduleConfigNewButtonHandler extends ButtonHandler {
  readonly customIDMatch = match(SCHEDULE_CONFIG_CUSTOM_IDS.OPEN_MODAL_BUTTON);

  constructor(
    private readonly scheduleChannelService: ScheduleChannelService,
    private readonly logger: Logger,
    private readonly emojiRepo: BotEmojiRepository,
  ) {
    super();
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command can only be used in a server.", flags: MessageFlags.Ephemeral });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL)
      .setTitle("Add Schedule Channel")
      .addComponents(
        new LabelBuilder()
          .setLabel("Google Calendar ID or URL")
          .setDescription("The Calendar ID or Public URL copied from Step 2")
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_FIELD_CALENDAR)
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder("abc123@group.calendar.google.com"),
          ),
        new LabelBuilder()
          .setLabel("Schedule name")
          .setDescription("Shown in schedule titles and alerts")
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_FIELD_NAME)
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder("Group Schedule"),
          ),
        new LabelBuilder()
          .setLabel("Public schedule channel")
          .setDescription("Where the schedule is posted — visible to all members")
          .setChannelSelectMenuComponent(
            new ChannelSelectMenuBuilder()
              .setCustomId(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_FIELD_CHANNEL)
              .addChannelTypes(ChannelType.GuildText),
          ),
        new LabelBuilder()
          .setLabel("Private log channel")
          .setDescription("Where event change alerts and errors are sent — keep this mod-only")
          .setChannelSelectMenuComponent(
            new ChannelSelectMenuBuilder()
              .setCustomId(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_FIELD_LOG_CHANNEL)
              .addChannelTypes(ChannelType.GuildText),
          ),
      );

    await interaction.showModal(modal);

    let submit;
    try {
      submit = await interaction.awaitModalSubmit({
        time: 5 * 60 * 1000,
        filter: (i) =>
          i.user.id === interaction.user.id &&
          i.customId === SCHEDULE_CONFIG_CUSTOM_IDS.MODAL,
      });
    } catch {
      // User dismissed the modal or it timed out — nothing to do
      return;
    }

    // Safety net — guild is guaranteed since the button was shown in a guild context
    if (!submit.guildId) {
      await submit.reply({ content: "This command can only be used in a server.", flags: MessageFlags.Ephemeral });
      return;
    }

    const calendarInput = submit.fields.getTextInputValue(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_FIELD_CALENDAR);
    const title = submit.fields.getTextInputValue(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_FIELD_NAME);

    const channels = submit.fields.getSelectedChannels(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_FIELD_CHANNEL, true, [ChannelType.GuildText]);
    const logChannels = submit.fields.getSelectedChannels(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_FIELD_LOG_CHANNEL, true, [ChannelType.GuildText]);

    const channel = channels?.first();
    const logChannel = logChannels?.first();

    const emojis = await this.emojiRepo.getEmojis(SCHEDULE_CONFIG_EMOJI_NAMES);

    if (!channel || !logChannel) {
      await submit.reply(makeContainer(`${emojis.fail} Please select both a schedule channel and a log channel.`, Color.Error, true));
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

    if (result.err) {
      await submit.reply(makeContainer(`${emojis.fail} ${result.val}`, Color.Error, true));
      return;
    }

    const sc = result.val;
    const intervalDisplay = formatPollInterval(sc.pollIntervalSec);

    const container = new ContainerBuilder()
      .setAccentColor(Color.Success)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${emojis.success} **Schedule channel configured**`),
      )
      .addSeparatorComponents(new SeparatorBuilder())
      .addSectionComponents(
        new SectionBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**Channel**\n<#${sc.channelId}>`,
          ),
        ),
      )
      .addSectionComponents(
        new SectionBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**Log channel**\n<#${sc.logChannelId}>`,
          ),
        ),
      )
      .addSectionComponents(
        new SectionBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**Name**\n${sc.displayTitle}`,
          ),
        ),
      )
      .addSectionComponents(
        new SectionBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**Google Calendar**\n${sc.calendarTitle}`,
          ),
        ),
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `-# Syncs ${intervalDisplay}`,
        ),
      );

    await submit.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });

    // Post confirmation to log channel (best-effort — never fail the command reply)
    try {
      const fetchedLogChannel = await submit.client.channels.fetch(sc.logChannelId.toString());
      if (fetchedLogChannel?.isTextBased() && !fetchedLogChannel.isDMBased()) {
        const logContainer = new ContainerBuilder()
          .setAccentColor(Color.Success)
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`${emojis.success} **Schedule channel configured**`),
          )
          .addSeparatorComponents(new SeparatorBuilder())
          .addSectionComponents(
            new SectionBuilder().addTextDisplayComponents(
              new TextDisplayBuilder().setContent(`**Channel**\n<#${sc.channelId}>`),
            ),
          )
          .addSectionComponents(
            new SectionBuilder().addTextDisplayComponents(
              new TextDisplayBuilder().setContent(`**Name**\n${sc.displayTitle}`),
            ),
          )
          .addSectionComponents(
            new SectionBuilder().addTextDisplayComponents(
              new TextDisplayBuilder().setContent(`**Google Calendar**\n${sc.calendarTitle}`),
            ),
          )
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# Syncs ${intervalDisplay}`),
          );
        await fetchedLogChannel.send({
          components: [logContainer],
          flags: MessageFlags.IsComponentsV2,
          allowedMentions: { parse: [] },
        });
      }
    } catch (err) {
      this.logger.warn(
        { err, logChannelId: sc.logChannelId.toString() },
        "Failed to post configuration confirmation to log channel",
      );
    }
  }
}
