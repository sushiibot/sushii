import opentelemetry from "@opentelemetry/api";
import { sleep } from "bun";
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Guild,
  MessageComponentInteraction,
  ModalMessageModalSubmitInteraction,
} from "discord.js";
import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";
import { buildFeedbackPanelButton } from "@/features/feedback/presentation/views/FeedbackButton";
import type {
  ScreeningSettingsPort,
  ScreeningSettingsState,
} from "@/features/member-screening/application/ScreeningSettingsPort";
import { buildInternalErrorContainer } from "@/interactions/responses/error";
import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { GuildSettingsService } from "../../application/GuildSettingsService";
import type { MessageLogBlockService } from "../../application/MessageLogBlockService";
import type {
  GuildSettingsPatch,
  SettingsPatch,
} from "../../application/SettingsPatch";
import { computeSettingsStatus } from "../../application/SettingsStatus";
import { resolveModalPrefills } from "../modals/modalFields";
import type { ModalContext } from "../modals/settingsModals";
import {
  buildSettingsModal,
  parseSettingsModal,
} from "../modals/settingsModals";
import { openSettingsModal } from "../session/openSettingsModal";
import type {
  SettingsEditTarget,
  SettingsTab,
  SettingsToggleTarget,
} from "../session/settingsIds";
import { isSettingsId, parseSettingsId } from "../session/settingsIds";
import { checkChannelHealth } from "../utils/ChannelHealth";
import {
  PANEL_EMOJI_NAMES,
  buildSettingsPanel,
} from "../views/panel/SettingsPanel";

const PANEL_IDLE_MS = 5 * 60 * 1000;
const EMOJI_NAMES = [...PANEL_EMOJI_NAMES, "message"] as const;
const REJECTION_DELETE_MS = 2500;
// Other end reasons (message, channel or guild deleted) leave nothing to redraw.
const EXPIRY_END_REASONS = new Set(["idle", "time"]);

const REJECTION_CONTENT =
  "Only the person who ran the command can use these buttons. Run `/settings` yourself to change settings.";

type FlagSetting = Extract<GuildSettingsPatch, { kind: "flag" }>["setting"];

const TOGGLE_FLAGS: Record<
  SettingsToggleTarget,
  { setting: FlagSetting; current: (config: GuildConfig) => boolean }
> = {
  lookup: {
    setting: "lookupOptIn",
    current: (config) => config.moderationSettings.lookupDetailsOptIn,
  },
  scam: {
    setting: "automodScamImage",
    current: (config) => config.moderationSettings.automodScamImageEnabled,
  },
  spam: {
    setting: "automodSpam",
    current: (config) => config.moderationSettings.automodSpamEnabled,
  },
};

type CommandInteraction = ChatInputCommandInteraction<"cached">;

interface PanelSession {
  interaction: CommandInteraction;
  tab: SettingsTab;
  collector: { readonly ended: boolean; resetTimer(): void };
  /** What the user last saw; Edit builds and parses modals from it so it can showModal without I/O. */
  ctx: ModalContext;
  togglesInFlight: Set<SettingsToggleTarget>;
}

type PanelPayload = ReturnType<typeof buildSettingsPanel>;

function configuredChannelIds(
  config: GuildConfig,
  screening: ScreeningSettingsState | null,
): string[] {
  const logs = config.loggingSettings;
  return [
    logs.modLogChannel,
    logs.memberLogChannel,
    logs.messageLogChannel,
    logs.reactionLogChannel,
    config.messageSettings.messageChannel,
    config.moderationSettings.automodAlertsChannelId,
    screening?.logChannelId,
  ].filter((id): id is string => !!id);
}

export default class SettingsCommand extends SlashCommandHandler {
  constructor(
    private readonly guildSettingsService: GuildSettingsService,
    private readonly messageLogBlockService: MessageLogBlockService,
    private readonly logger: Logger,
    private readonly emojiRepository: BotEmojiRepository,
    private readonly screeningSettings: ScreeningSettingsPort | null,
    private readonly rejectionDeleteMs: number = REJECTION_DELETE_MS,
  ) {
    super();
  }

  command = new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Configure sushii server settings.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .toJSON();

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild not cached.");
    }

    return this.showSettingsPanel(interaction);
  }

  private async getScreening(
    guildId: string,
  ): Promise<ScreeningSettingsState | null> {
    if (!this.screeningSettings) {
      return null;
    }

    try {
      return await this.screeningSettings.getForSettings(guildId);
    } catch (err) {
      // An optional section; a flag or DB outage shouldn't break the whole panel.
      this.logger.warn(
        { err, guildId },
        "Failed to load screening settings, hiding the section",
      );
      return null;
    }
  }

  private async loadContext(guild: Guild): Promise<ModalContext> {
    const [config, blocks, screening] = await Promise.all([
      this.guildSettingsService.getGuildSettings(guild.id),
      this.messageLogBlockService.getIgnoredChannels(guild.id),
      this.getScreening(guild.id),
    ]);
    const channelHealth = checkChannelHealth(
      guild,
      configuredChannelIds(config, screening),
    );

    const ignoredChannelIds = blocks.map((block) => block.channelId);

    return {
      config,
      screening,
      ignoredChannelIds,
      ...resolveModalPrefills(
        guild,
        ignoredChannelIds,
        config.moderationSettings.automodExemptRoleIds,
      ),
      status: computeSettingsStatus({ config, screening, channelHealth }),
    };
  }

  private async renderPanel(
    interaction: CommandInteraction,
    tab: SettingsTab,
    expired: boolean,
  ): Promise<{ payload: PanelPayload; ctx: ModalContext }> {
    const [ctx, emojis] = await Promise.all([
      this.loadContext(interaction.guild),
      this.emojiRepository.getEmojis(EMOJI_NAMES),
    ]);

    const payload = buildSettingsPanel(
      {
        tab,
        ...ctx,
        emojis,
        expired,
        preview: {
          userId: interaction.user.id,
          username: interaction.user.username,
          guildName: interaction.guild.name,
          memberCount: interaction.guild.memberCount,
        },
      },
      // An unsynced app emoji is "", which ButtonBuilder rejects.
      buildFeedbackPanelButton(`settings.${tab}`, emojis.message || undefined),
    );

    return { payload, ctx };
  }

  private async renderSession(
    session: PanelSession,
    expired: boolean,
  ): Promise<PanelPayload> {
    const { payload, ctx } = await this.renderPanel(
      session.interaction,
      session.tab,
      expired,
    );
    session.ctx = ctx;
    return payload;
  }

  private async followUpInternalError(
    acked:
      | ButtonInteraction<"cached">
      | ModalMessageModalSubmitInteraction<"cached">,
  ): Promise<void> {
    const traceId = opentelemetry.trace.getActiveSpan()?.spanContext().traceId;
    try {
      await acked.followUp({
        components: [buildInternalErrorContainer(acked.user.id, traceId)],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      this.logger.warn(
        { err, guildId: acked.guildId },
        "Failed to send settings error follow-up",
      );
    }
  }

  private async showSettingsPanel(
    interaction: CommandInteraction,
  ): Promise<void> {
    const initial = await this.renderPanel(interaction, "overview", false);
    const response = await interaction.reply({
      ...initial.payload,
      withResponse: true,
    });
    const msg = response.resource?.message;
    if (!msg) {
      throw new Error("Settings reply did not return a message");
    }

    const collector = msg.createMessageComponentCollector({
      idle: PANEL_IDLE_MS,
      // Other IDs on the panel (the feedback button) belong to the global router.
      filter: (i) => isSettingsId(i.customId),
    });
    const session: PanelSession = {
      interaction,
      tab: "overview",
      collector,
      ctx: initial.ctx,
      togglesInFlight: new Set(),
    };

    collector.on("collect", async (i) => {
      try {
        if (i.user.id !== interaction.user.id) {
          const rejection = await i.reply({
            content: REJECTION_CONTENT,
            flags: MessageFlags.Ephemeral,
          });
          await sleep(this.rejectionDeleteMs);
          await rejection.delete();
          return;
        }

        await this.handleClick(session, i);
      } catch (err) {
        this.logger.error(
          { err, customId: i.customId, guildId: interaction.guildId },
          "Failed to handle settings interaction",
        );
        // Deferred means the click was acked without a reply, so the error would otherwise be silent.
        if (i.inCachedGuild() && i.isButton() && i.deferred) {
          await this.followUpInternalError(i);
        }
      }
    });

    collector.on("end", async (_collected, reason) => {
      if (!EXPIRY_END_REASONS.has(reason)) {
        return;
      }

      try {
        const payload = await this.renderSession(session, true);
        await this.redrawExpired(interaction, msg.id, payload);
      } catch (err) {
        this.logger.warn(
          { err, guildId: interaction.guildId },
          "Failed to redraw the expired settings panel",
        );
      }
    });
  }

  private async redrawExpired(
    interaction: CommandInteraction,
    messageId: string,
    payload: PanelPayload,
  ): Promise<void> {
    try {
      await interaction.editReply(payload);
      return;
    } catch (err) {
      // The interaction token expires after 15 minutes; the bot token still works.
      this.logger.debug(
        { err, guildId: interaction.guildId },
        "Editing the settings reply failed, editing the message directly",
      );
    }

    if (!interaction.channel) {
      throw new Error("Settings panel channel is not cached");
    }
    await interaction.channel.messages.edit(messageId, payload);
  }

  private async handleClick(
    session: PanelSession,
    i: MessageComponentInteraction,
  ): Promise<void> {
    const parsed = parseSettingsId(i.customId);
    if (!parsed || parsed.kind === "modal" || !i.inCachedGuild()) {
      throw new Error("Unexpected settings interaction", {
        cause: { customId: i.customId },
      });
    }
    if (!i.isButton()) {
      throw new Error("Settings interaction is not a button", {
        cause: { customId: i.customId },
      });
    }

    switch (parsed.kind) {
      case "tab":
        // Rendering reads the DB and checks channels, so acknowledge first.
        await i.deferUpdate();
        session.tab = parsed.tab;
        await i.editReply(await this.renderSession(session, false));
        return;
      case "toggle":
        await this.handleToggle(session, i, parsed.target);
        return;
      case "edit":
        await this.handleEdit(session, i, parsed.target);
        return;
    }
  }

  private async handleToggle(
    session: PanelSession,
    i: ButtonInteraction<"cached">,
    target: SettingsToggleTarget,
  ): Promise<void> {
    await i.deferUpdate();
    // A double click would read the same value twice and flip it back.
    if (session.togglesInFlight.has(target)) {
      return;
    }

    session.togglesInFlight.add(target);
    try {
      const flag = TOGGLE_FLAGS[target];
      const config = await this.guildSettingsService.getGuildSettings(
        i.guildId,
      );
      await this.guildSettingsService.apply(i.guildId, {
        kind: "flag",
        setting: flag.setting,
        enabled: !flag.current(config),
      });
    } finally {
      session.togglesInFlight.delete(target);
    }

    await i.editReply(await this.renderSession(session, false));
  }

  private async handleEdit(
    session: PanelSession,
    i: ButtonInteraction<"cached">,
    target: SettingsEditTarget,
  ): Promise<void> {
    const ctx = session.ctx;
    const submission = await openSettingsModal(
      i,
      buildSettingsModal(target, ctx),
      { collector: session.collector },
    );
    // Dismissed or timed out: the user may have moved on, so leave the panel alone.
    if (!submission) {
      return;
    }
    await submission.deferUpdate();

    try {
      for (const patch of parseSettingsModal(target, submission, ctx)) {
        await this.applyPatch(i.guildId, patch);
      }

      // A submit that lands after the collector ended must not re-enable a dead panel.
      await submission.editReply(
        await this.renderSession(session, session.collector.ended),
      );
    } catch (err) {
      await this.followUpInternalError(submission);
      throw err;
    }
  }

  private async applyPatch(
    guildId: string,
    patch: SettingsPatch,
  ): Promise<void> {
    switch (patch.kind) {
      case "messageLogIgnored":
        await this.messageLogBlockService.setIgnoredChannels(
          guildId,
          patch.channelIds,
        );
        return;
      case "screening":
        if (!this.screeningSettings) {
          throw new Error("Screening patch without a screening port");
        }
        await this.screeningSettings.setLogChannel(guildId, patch.channelId);
        await this.screeningSettings.setCheckAvatars(
          guildId,
          patch.checkAvatars,
        );
        return;
      default:
        await this.guildSettingsService.apply(guildId, patch);
    }
  }
}
