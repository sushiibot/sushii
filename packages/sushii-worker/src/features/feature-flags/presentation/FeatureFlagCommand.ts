import type { APIGuild, ChatInputCommandInteraction } from "discord.js";
import {
  ApplicationIntegrationType,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  Routes,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder,
  TimestampStyles,
  escapeMarkdown,
  time,
} from "discord.js";
import type { Logger } from "pino";

import type { ScreeningSettingsState } from "@/features/member-screening/application/ScreeningSettingsPort";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { FeatureFlag, FeatureFlagEntry } from "../domain/FeatureFlag";
import { FEATURE_FLAGS } from "../domain/FeatureFlag";
import type { FeatureFlagRepository } from "../domain/FeatureFlagRepository";

const SNOWFLAKE_PATTERN = /^\d{17,19}$/;
const ENABLED_ACCENT = 0x57f287;
// Each guild is a separator plus a text display; this stays under the 40-component limit.
const MAX_LISTED_GUILDS = 15;

export interface ScreeningStateReader {
  getState(guildId: string): Promise<ScreeningSettingsState | null>;
}

export interface FeatureFlagListGuild {
  entry: FeatureFlagEntry;
  name: string | undefined;
  /** Undefined when the flag has no per-guild state to show. */
  screening?: ScreeningSettingsState | null | "unavailable";
}

function guildLabel(guildId: string, name: string | undefined): string {
  return name
    ? `**${escapeMarkdown(name)}** (\`${guildId}\`)`
    : `\`${guildId}\``;
}

export function screeningStateLine(
  state: ScreeningSettingsState | null | "unavailable",
): string {
  if (state === "unavailable") {
    return "Screening state unavailable";
  }
  if (!state?.enabled) {
    return "Off — mods haven't turned it on";
  }
  if (!state.logChannelId) {
    return "⚠️ Flag on — waiting for mods to pick a log channel";
  }
  return `✅ Screening on · posting to <#${state.logChannelId}>`;
}

export function buildFlagEnabled(
  flag: FeatureFlag,
  guildId: string,
  name: string | undefined,
): ContainerBuilder {
  const lines = [`Enabled \`${flag}\` for ${guildLabel(guildId, name)}.`];
  if (flag === "member_screening") {
    lines.push(
      "-# Server moderators can now set it up in `/settings` → Automod. It can take up to a minute to show up there.",
    );
  }

  return new ContainerBuilder()
    .setAccentColor(ENABLED_ACCENT)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(lines.join("\n")),
    );
}

export function buildFlagDisabled(
  flag: FeatureFlag,
  guildId: string,
  name: string | undefined,
): ContainerBuilder {
  const lines = [`Disabled \`${flag}\` for ${guildLabel(guildId, name)}.`];
  if (flag === "member_screening") {
    lines.push(
      "-# Screening stops within a minute. The server's screening settings are kept.",
    );
  }

  return new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines.join("\n")),
  );
}

/** Shows at most MAX_LISTED_GUILDS of `guilds`; `total` counts every guild with the flag. */
export function buildFlagList(
  flag: FeatureFlag,
  guilds: FeatureFlagListGuild[],
  total = guilds.length,
): ContainerBuilder {
  const serverLabel = total === 1 ? "server" : "servers";
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Feature flags\n-# \`${flag}\` · ${total} ${serverLabel}`,
    ),
  );

  if (total === 0) {
    return container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "No servers have this flag yet.\n-# Turn it on with `/feature-flag enable`.",
      ),
    );
  }

  const shown = guilds.slice(0, MAX_LISTED_GUILDS);
  for (const { entry, name, screening } of shown) {
    const lines = [
      `### ${name ? escapeMarkdown(name) : entry.guildId}`,
      `-# \`${entry.guildId}\` · enabled by <@${entry.enabledBy}> ${time(entry.enabledAt, TimestampStyles.RelativeTime)}`,
    ];
    if (screening !== undefined) {
      lines.push(screeningStateLine(screening));
    }

    container
      .addSeparatorComponents(
        new SeparatorBuilder()
          .setDivider(true)
          .setSpacing(SeparatorSpacingSize.Large),
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(lines.join("\n")),
      );
  }

  const hidden = total - shown.length;
  if (hidden > 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# …and ${hidden} more`),
    );
  }

  return container;
}

export class FeatureFlagCommand extends SlashCommandHandler {
  // sushii home guild; flags are bot-owner-managed
  readonly registeredGuilds = ["418504865543749642"] as const;

  readonly command = new SlashCommandBuilder()
    .setName("feature-flag")
    .setDescription("Turn per-server feature flags on or off")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .addSubcommand((sub) =>
      sub
        .setName("enable")
        .setDescription("Turn a flag on for a server")
        .addStringOption((opt) =>
          opt.setName("guild_id").setDescription("Server ID").setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("flag")
            .setDescription("Feature flag")
            .setRequired(true)
            .addChoices(FEATURE_FLAGS.map((f) => ({ name: f, value: f }))),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("disable")
        .setDescription("Turn a flag off for a server")
        .addStringOption((opt) =>
          opt.setName("guild_id").setDescription("Server ID").setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("flag")
            .setDescription("Feature flag")
            .setRequired(true)
            .addChoices(FEATURE_FLAGS.map((f) => ({ name: f, value: f }))),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("List servers with a flag on")
        .addStringOption((opt) =>
          opt
            .setName("flag")
            .setDescription("Feature flag")
            .setRequired(true)
            .addChoices(FEATURE_FLAGS.map((f) => ({ name: f, value: f }))),
        ),
    )
    .toJSON();

  constructor(
    private readonly repo: FeatureFlagRepository,
    private readonly screening: ScreeningStateReader | null,
    private readonly ownerUserId: string | undefined,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    // Registered in the home guild, where other admins exist too.
    if (!this.ownerUserId || interaction.user.id !== this.ownerUserId) {
      await interaction.reply({
        content: "Only the bot owner can use this.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const sub = interaction.options.getSubcommand(true);
    const flag = this.parseFlag(interaction.options.getString("flag", true));

    if (!flag) {
      await this.replyText(
        interaction,
        `\`flag\` must be one of: ${FEATURE_FLAGS.join(", ")}.`,
      );
      return;
    }

    switch (sub) {
      case "enable":
        await this.handleEnable(interaction, flag);
        break;
      case "disable":
        await this.handleDisable(interaction, flag);
        break;
      case "list":
        await this.handleList(interaction, flag);
        break;
      default:
        this.logger.warn({ sub }, "Unknown subcommand");
        break;
    }
  }

  private parseFlag(value: string): FeatureFlag | null {
    const known: readonly string[] = FEATURE_FLAGS;
    return known.includes(value) ? (value as FeatureFlag) : null;
  }

  private async readGuildId(
    interaction: ChatInputCommandInteraction,
  ): Promise<string | null> {
    const guildId = interaction.options.getString("guild_id", true).trim();
    if (!SNOWFLAKE_PATTERN.test(guildId)) {
      await this.replyText(interaction, "`guild_id` must be a server ID.");
      return null;
    }
    return guildId;
  }

  private async handleEnable(
    interaction: ChatInputCommandInteraction,
    flag: FeatureFlag,
  ): Promise<void> {
    const guildId = await this.readGuildId(interaction);
    if (!guildId) {
      return;
    }

    await this.repo.enable(guildId, flag, interaction.user.id);
    this.logger.info(
      { guildId, flag, enabledBy: interaction.user.id },
      "Enabled feature flag",
    );

    const name = await this.fetchGuildName(interaction, guildId);
    await this.replyContainer(
      interaction,
      buildFlagEnabled(flag, guildId, name),
    );
  }

  private async handleDisable(
    interaction: ChatInputCommandInteraction,
    flag: FeatureFlag,
  ): Promise<void> {
    const guildId = await this.readGuildId(interaction);
    if (!guildId) {
      return;
    }

    const disabled = await this.repo.disable(guildId, flag);
    if (!disabled) {
      await this.replyText(
        interaction,
        `\`${flag}\` isn't on for \`${guildId}\`.`,
      );
      return;
    }

    this.logger.info(
      { guildId, flag, disabledBy: interaction.user.id },
      "Disabled feature flag",
    );

    const name = await this.fetchGuildName(interaction, guildId);
    await this.replyContainer(
      interaction,
      buildFlagDisabled(flag, guildId, name),
    );
  }

  private async handleList(
    interaction: ChatInputCommandInteraction,
    flag: FeatureFlag,
  ): Promise<void> {
    // defer: fetches the name of every listed guild over REST
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Newest first, so the cap hides the oldest.
    const entries = (await this.repo.listGuilds(flag)).sort(
      (a, b) => b.enabledAt.getTime() - a.enabledAt.getTime(),
    );
    const screening = flag === "member_screening" ? this.screening : null;

    const guilds = await Promise.all(
      entries
        .slice(0, MAX_LISTED_GUILDS)
        .map(async (entry): Promise<FeatureFlagListGuild> => {
          const [name, state] = await Promise.all([
            this.fetchGuildName(interaction, entry.guildId),
            screening ? this.readScreeningState(entry.guildId) : undefined,
          ]);
          return { entry, name, screening: state };
        }),
    );
    await interaction.editReply({
      components: [buildFlagList(flag, guilds, entries.length)],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
  }

  private async readScreeningState(
    guildId: string,
  ): Promise<ScreeningSettingsState | null | "unavailable"> {
    try {
      return (await this.screening?.getState(guildId)) ?? null;
    } catch (err) {
      // Per-guild isolation: one failed lookup shouldn't fail the whole list.
      this.logger.warn({ err, guildId }, "Failed to read screening state");
      return "unavailable";
    }
  }

  private async fetchGuildName(
    interaction: ChatInputCommandInteraction,
    guildId: string,
  ): Promise<string | undefined> {
    try {
      // REST, not guilds.fetch: the guild may live on another cluster and shouldn't enter this cache.
      const guild = (await interaction.client.rest.get(
        Routes.guild(guildId),
      )) as APIGuild;
      return guild.name;
    } catch (err) {
      // Best-effort: the reply falls back to the guild ID.
      this.logger.debug({ err, guildId }, "Failed to fetch guild name");
      return undefined;
    }
  }

  private async replyText(
    interaction: ChatInputCommandInteraction,
    content: string,
  ): Promise<void> {
    await this.replyContainer(
      interaction,
      new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(content),
      ),
    );
  }

  private async replyContainer(
    interaction: ChatInputCommandInteraction,
    container: ContainerBuilder,
  ): Promise<void> {
    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }
}
