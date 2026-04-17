import opentelemetry, { SpanStatusCode } from "@opentelemetry/api";
import {
  ButtonInteraction,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
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
  parseHexColor,
  SCHEDULE_CONFIG_CUSTOM_IDS,
  MODAL_AWAIT_TIMEOUT_MS,
  SCHEDULE_CONFIG_EMOJI_NAMES,
} from "../ScheduleConfigConstants";

const tracer = opentelemetry.trace.getTracer("schedule");

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

    const invokerId = interaction.message.interactionMetadata?.user.id;
    if (invokerId && interaction.user.id !== invokerId) {
      await interaction.reply({
        content: "Only the user who ran this command can use this button.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Unique per open so Discord never serves a cached version of this modal.
    const modalCustomId = `${SCHEDULE_CONFIG_CUSTOM_IDS.MODAL}:${Date.now().toString(36)}`;

    const modal = new ModalBuilder()
      .setCustomId(modalCustomId)
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
              .setMinLength(1)
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
        new LabelBuilder()
          .setLabel("Accent color (optional)")
          .setDescription("Hex code for the schedule accent bar — leave blank for no accent color")
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_FIELD_COLOR)
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setMinLength(0)
              .setMaxLength(7)
              .setPlaceholder("#96cdfb"),
          ),
      );

    await interaction.showModal(modal);

    // Span covers the full wait so we can see how long users take to fill the form.
    const submit = await tracer.startActiveSpan(
      "schedule.config.new.modal_await",
      async (awaitSpan) => {
        try {
          return await interaction.awaitModalSubmit({
            time: MODAL_AWAIT_TIMEOUT_MS,
            filter: (i) =>
              i.user.id === interaction.user.id &&
              i.customId === modalCustomId,
          });
        } catch {
          // User dismissed the modal or it timed out — nothing to do
          return null;
        } finally {
          awaitSpan.end();
        }
      },
    );

    if (!submit) {
      return;
    }

    // Safety net — guild is guaranteed since the button was shown in a guild context
    if (!submit.guildId) {
      await submit.reply({ content: "This command can only be used in a server.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (!submit.isFromMessage()) {
      throw new Error("Modal should be from a button on a message");
    }

    // Extract guildId as a const so TypeScript retains the non-null narrowing inside async closures.
    const guildId = submit.guildId;

    await tracer.startActiveSpan(
      "schedule.config.new.modal_submit",
      async (submitSpan) => {
        submitSpan.setAttributes({
          "discord.interaction.id": submit.id,
          "user.id": submit.user.id,
          "guild.id": guildId,
        });

        try {
          // deferUpdate() + editReply() instead of update(): the button lives on an IsComponentsV2
          // message and Discord returns 10062 for type-7 UPDATE_MESSAGE responses in that context.
          // deferUpdate() (type 6) acknowledges immediately; editReply() PATCHes the message via
          // the webhook endpoint which handles IsComponentsV2 correctly.
          await submit.deferUpdate();
          submitSpan.addEvent("deferUpdate");

          const calendarInput = submit.fields.getTextInputValue(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_FIELD_CALENDAR);
          const title = submit.fields.getTextInputValue(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_FIELD_NAME);
          const colorInput = submit.fields.getTextInputValue(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_FIELD_COLOR);

          const channels = submit.fields.getSelectedChannels(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_FIELD_CHANNEL, true, [ChannelType.GuildText]);
          const logChannels = submit.fields.getSelectedChannels(SCHEDULE_CONFIG_CUSTOM_IDS.MODAL_FIELD_LOG_CHANNEL, true, [ChannelType.GuildText]);

          const channel = channels?.first();
          const logChannel = logChannels?.first();

          const emojis = await this.emojiRepo.getEmojis(SCHEDULE_CONFIG_EMOJI_NAMES);

          if (!channel || !logChannel) {
            // editReply inherits ephemerality from deferUpdate — no need to pass the ephemeral flag
            await submit.editReply(makeContainer(`${emojis.fail} Please select both a schedule channel and a log channel.`, Color.Error));
            return;
          }

          const colorResult = parseHexColor(colorInput);
          if (colorResult.err) {
            await submit.editReply(makeContainer(`${emojis.fail} ${colorResult.val}`, Color.Error));
            return;
          }

          const result = await this.scheduleChannelService.configure({
            guildId: BigInt(guildId),
            channelId: BigInt(channel.id),
            logChannelId: BigInt(logChannel.id),
            configuredByUserId: BigInt(submit.user.id),
            calendarInput,
            title,
            accentColor: colorResult.val,
          });

          if (result.err) {
            await submit.editReply(makeContainer(`${emojis.fail} ${result.val}`, Color.Error));
            return;
          }

          const schedule = result.val;
          const intervalDisplay = formatPollInterval(schedule.pollIntervalSec);

          const container = new ContainerBuilder()
            .setAccentColor(Color.Success)
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(`${emojis.success} **Schedule channel configured**`),
            )
            .addSeparatorComponents(new SeparatorBuilder())
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(
                `**Channel**\n<#${schedule.channelId}>\n**Log channel**\n<#${schedule.logChannelId}>\n**Name**\n${schedule.displayTitle}\n**Google Calendar**\n${schedule.calendarTitle}`,
              ),
            )
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(`-# Syncs ${intervalDisplay}`),
            );

          await submit.editReply({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
          });
          submitSpan.addEvent("editReply");

          // Post confirmation to log channel (best-effort — never fail the command reply)
          try {
            const fetchedLogChannel = await submit.client.channels.fetch(schedule.logChannelId.toString());
            if (fetchedLogChannel?.isTextBased() && !fetchedLogChannel.isDMBased()) {
              const logContainer = new ContainerBuilder()
                .setAccentColor(Color.Success)
                .addTextDisplayComponents(
                  new TextDisplayBuilder().setContent(`${emojis.success} **Schedule channel configured**`),
                )
                .addSeparatorComponents(new SeparatorBuilder())
                .addTextDisplayComponents(
                  new TextDisplayBuilder().setContent(
                    `**Channel**\n<#${schedule.channelId}>\n**Name**\n${schedule.displayTitle}\n**Google Calendar**\n${schedule.calendarTitle}`,
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
              { err, logChannelId: schedule.logChannelId.toString() },
              "Failed to post configuration confirmation to log channel — check bot permissions",
            );
          }
        } catch (err) {
          submitSpan.recordException(err instanceof Error ? err : new Error(String(err)));
          submitSpan.setStatus({ code: SpanStatusCode.ERROR });
          throw err;
        } finally {
          submitSpan.end();
        }
      },
    );
  }
}
