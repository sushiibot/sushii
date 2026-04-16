import {
  ChannelSelectMenuBuilder,
  ChannelType,
  type ChatInputCommandInteraction,
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
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";
import Color from "@/utils/colors";

import type { ScheduleChannelService } from "../../application/ScheduleChannelService";
import {
  formatHexColor,
  makeContainer,
  parseHexColor,
  SCHEDULE_CONFIG_CUSTOM_IDS,
  SCHEDULE_CONFIG_EMOJI_NAMES,
  SCHEDULE_CONFIG_OPTIONS,
} from "../ScheduleConfigConstants";

export class ScheduleConfigEditHandler {
  constructor(
    private readonly scheduleChannelService: ScheduleChannelService,
    private readonly logger: Logger,
    private readonly emojiRepo: BotEmojiRepository,
  ) {}

  async handle(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command can only be used in a server.", flags: MessageFlags.Ephemeral });
      return;
    }

    const channelIdStr = interaction.options.getString(SCHEDULE_CONFIG_OPTIONS.SCHEDULE, true);
    const emojis = await this.emojiRepo.getEmojis(SCHEDULE_CONFIG_EMOJI_NAMES);

    const existing = await this.scheduleChannelService.getByChannel(
      BigInt(interaction.guildId),
      BigInt(channelIdStr),
    );

    if (!existing) {
      await interaction.reply(makeContainer(`${emojis.fail} No schedule channel is configured for that channel.`, Color.Error, true));
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_EDIT)
      .setTitle("Edit Schedule Channel")
      .addComponents(
        new LabelBuilder()
          .setLabel("Schedule name")
          .setDescription("Shown in schedule titles and alerts")
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_EDIT_FIELD_NAME)
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMinLength(1)
              .setValue(existing.displayTitle),
          ),
        new LabelBuilder()
          .setLabel("Public schedule channel")
          .setDescription("Where the schedule is posted — visible to all members")
          .setChannelSelectMenuComponent(
            new ChannelSelectMenuBuilder()
              .setCustomId(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_EDIT_FIELD_CHANNEL)
              .addChannelTypes(ChannelType.GuildText)
              .setDefaultChannels([existing.channelId.toString()]),
          ),
        new LabelBuilder()
          .setLabel("Private log channel")
          .setDescription("Where event change alerts and errors are sent — keep this mod-only")
          .setChannelSelectMenuComponent(
            new ChannelSelectMenuBuilder()
              .setCustomId(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_EDIT_FIELD_LOG_CHANNEL)
              .addChannelTypes(ChannelType.GuildText)
              .setDefaultChannels([existing.logChannelId.toString()]),
          ),
        new LabelBuilder()
          .setLabel("Accent color (optional)")
          .setDescription("Hex code for the schedule accent bar — leave blank for no accent color")
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_EDIT_FIELD_COLOR)
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setMinLength(0)
              .setMaxLength(7)
              .setPlaceholder("#96cdfb")
              .setValue(
                existing.accentColor != null ? formatHexColor(existing.accentColor) : "",
              ),
          ),
      );

    await interaction.showModal(modal);

    let submit;
    try {
      submit = await interaction.awaitModalSubmit({
        time: 5 * 60 * 1000,
        filter: (i) =>
          i.user.id === interaction.user.id &&
          i.customId === SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_EDIT,
      });
    } catch {
      // User dismissed the modal or it timed out — nothing to do
      return;
    }

    if (!submit.guildId) {
      await submit.reply({ content: "This command can only be used in a server.", flags: MessageFlags.Ephemeral });
      return;
    }

    const newTitle = submit.fields.getTextInputValue(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_EDIT_FIELD_NAME);
    const colorInput = submit.fields.getTextInputValue(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_EDIT_FIELD_COLOR);
    const channels = submit.fields.getSelectedChannels(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_EDIT_FIELD_CHANNEL, true, [ChannelType.GuildText]);
    const logChannels = submit.fields.getSelectedChannels(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_EDIT_FIELD_LOG_CHANNEL, true, [ChannelType.GuildText]);

    const channel = channels?.first();
    const logChannel = logChannels?.first();

    if (!channel || !logChannel) {
      await submit.reply(makeContainer(`${emojis.fail} Please select both a schedule channel and a log channel.`, Color.Error, true));
      return;
    }

    const colorResult = parseHexColor(colorInput);
    if (colorResult.err) {
      await submit.reply(makeContainer(`${emojis.fail} ${colorResult.val}`, Color.Error, true));
      return;
    }

    const result = await this.scheduleChannelService.edit({
      guildId: BigInt(submit.guildId),
      channelId: BigInt(channelIdStr),
      editedByUserId: BigInt(submit.user.id),
      newDisplayTitle: newTitle,
      newChannelId: BigInt(channel.id),
      newLogChannelId: BigInt(logChannel.id),
      newAccentColor: colorResult.val,
    });

    if (result.err) {
      await submit.reply(makeContainer(`${emojis.fail} ${result.val}`, Color.Error, true));
      return;
    }

    const { schedule, changedFields } = result.val;

    const changeSummaryLines: string[] = [];
    if (changedFields.includes("displayTitle")) {
      changeSummaryLines.push(`**Name** → ${schedule.displayTitle}`);
    }
    if (changedFields.includes("channelId")) {
      changeSummaryLines.push(`**Channel** → <#${schedule.channelId}> — reposting current month`);
    }
    if (changedFields.includes("logChannelId")) {
      changeSummaryLines.push(`**Log channel** → <#${schedule.logChannelId}>`);
    }
    if (changedFields.includes("accentColor")) {
      const colorStr = schedule.accentColor != null ? formatHexColor(schedule.accentColor) : "none";
      changeSummaryLines.push(`**Accent color** → ${colorStr}`);
    }

    const container = new ContainerBuilder()
      .setAccentColor(Color.Success)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${emojis.success} **Schedule updated**`),
      )
      .addSeparatorComponents(new SeparatorBuilder())
      .addSectionComponents(
        new SectionBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(changeSummaryLines.join("\n")),
        ),
      );

    await submit.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }
}
