import type {
  APIChannel,
  APIGuild,
  ChatInputCommandInteraction,
  REST,
} from "discord.js";
import {
  ApplicationIntegrationType,
  ChannelType,
  ContainerBuilder,
  DiscordAPIError,
  MessageFlags,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  Routes,
  SlashCommandBuilder,
  TextDisplayBuilder,
} from "discord.js";
import type { Logger } from "pino";

import dayjs from "@/shared/domain/dayjs";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { ScreeningGuildRepository } from "../../domain/repositories/ScreeningGuildRepository";
import type { ScreeningVerdictRepository } from "../../domain/repositories/ScreeningVerdictRepository";
import type {
  ScreeningGuildSettings,
  ScreeningRuleId,
} from "../../domain/types";
import { SCREENING_DEFAULTS, SCREENING_RULE_IDS } from "../../domain/types";
import { buildScreeningStatus } from "../views/ScreeningStatusView";

const SNOWFLAKE_PATTERN = /^\d{17,19}$/;
const STATUS_WINDOW_DAYS = 7;
const WINDOW_HOURS_MAX = 168;
const MAX_MESSAGES_MAX = 200;

type RulesParseResult =
  | { ok: true; rules: ScreeningRuleId[] | null }
  | { ok: false; invalid: string[] };

export function parseRules(input: string): RulesParseResult {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "default") {
    return { ok: true, rules: null };
  }

  const ids = [
    ...new Set(
      trimmed
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ),
  ];
  const known: readonly string[] = SCREENING_RULE_IDS;
  const invalid = ids.filter((id) => !known.includes(id));

  if (ids.length === 0 || invalid.length > 0) {
    return { ok: false, invalid };
  }

  return { ok: true, rules: ids as ScreeningRuleId[] };
}

const LOG_CHANNEL_TYPES: readonly ChannelType[] = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
];

/**
 * Returns a validation message, or null when the channel is a text channel in the guild.
 * Uses REST because the guild usually isn't cached on the cluster running this command.
 */
export async function validateLogChannel(
  rest: Pick<REST, "get">,
  guildId: string,
  channelId: string,
): Promise<string | null> {
  if (!SNOWFLAKE_PATTERN.test(channelId)) {
    return "`log_channel_id` must be a channel ID.";
  }

  let channel: APIChannel;
  try {
    channel = (await rest.get(Routes.channel(channelId))) as APIChannel;
  } catch (err) {
    if (
      err instanceof DiscordAPIError &&
      (err.code === RESTJSONErrorCodes.UnknownChannel ||
        err.code === RESTJSONErrorCodes.MissingAccess)
    ) {
      return `sushii can't see channel \`${channelId}\`.`;
    }
    throw err;
  }

  if (!("guild_id" in channel) || channel.guild_id !== guildId) {
    return `Channel \`${channelId}\` isn't in server \`${guildId}\`.`;
  }

  if (!LOG_CHANNEL_TYPES.includes(channel.type)) {
    return `<#${channelId}> must be a text or announcement channel.`;
  }

  return null;
}

export class MemberScreeningCommand extends SlashCommandHandler {
  // sushii home guild; screening access is bot-owner-managed
  readonly registeredGuilds = ["418504865543749642"] as const;

  readonly command = new SlashCommandBuilder()
    .setName("member-screening")
    .setDescription("Manage the new member screening allowlist")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .addSubcommand((sub) =>
      sub
        .setName("enable")
        .setDescription("Allowlist a server for member screening")
        .addStringOption((opt) =>
          opt.setName("guild_id").setDescription("Server ID").setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("log_channel_id")
            .setDescription("Channel ID to post flags in")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("disable")
        .setDescription("Remove a server from the allowlist")
        .addStringOption((opt) =>
          opt.setName("guild_id").setDescription("Server ID").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("configure")
        .setDescription("Change screening settings for an allowlisted server")
        .addStringOption((opt) =>
          opt.setName("guild_id").setDescription("Server ID").setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("log_channel_id")
            .setDescription(
              'Channel ID to post flags in, or "none" to stop posting',
            ),
        )
        .addIntegerOption((opt) =>
          opt
            .setName("max_messages")
            .setDescription("Screen this many messages since join")
            .setMinValue(1)
            .setMaxValue(MAX_MESSAGES_MAX),
        )
        .addIntegerOption((opt) =>
          opt
            .setName("window_hours")
            .setDescription("Screen for this many hours since join")
            .setMinValue(1)
            .setMaxValue(WINDOW_HOURS_MAX),
        )
        .addNumberOption((opt) =>
          opt
            .setName("review_threshold")
            .setDescription("Score at or above which a message is flagged")
            .setMinValue(0)
            .setMaxValue(1),
        )
        .addStringOption((opt) =>
          opt
            .setName("rules")
            .setDescription(
              `Comma-separated rule IDs (${SCREENING_RULE_IDS.join(", ")}), or "default"`,
            ),
        )
        .addBooleanOption((opt) =>
          opt
            .setName("check_avatars")
            .setDescription("Check new member avatars"),
        )
        .addIntegerOption((opt) =>
          opt
            .setName("daily_check_cap")
            .setDescription("Maximum checks per UTC day")
            .setMinValue(1),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Show allowlisted servers and stats"),
    )
    .toJSON();

  constructor(
    private readonly guildRepo: ScreeningGuildRepository,
    private readonly verdictRepo: ScreeningVerdictRepository,
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

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    switch (sub) {
      case "enable":
        await this.handleEnable(interaction);
        break;
      case "disable":
        await this.handleDisable(interaction);
        break;
      case "configure":
        await this.handleConfigure(interaction);
        break;
      case "status":
        await this.handleStatus(interaction);
        break;
      default:
        this.logger.warn({ sub }, "Unknown subcommand");
        break;
    }
  }

  private async handleEnable(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const guildId = interaction.options.getString("guild_id", true).trim();
    const logChannelId = interaction.options
      .getString("log_channel_id", true)
      .trim();

    if (!SNOWFLAKE_PATTERN.test(guildId)) {
      await this.reply(interaction, "`guild_id` must be a server ID.");
      return;
    }

    const existing = (await this.guildRepo.list()).find(
      (s) => s.guildId === guildId,
    );
    if (existing) {
      await this.reply(
        interaction,
        `\`${guildId}\` is already enabled. Use \`/member-screening configure\` to change its settings.`,
      );
      return;
    }

    const channelError = await validateLogChannel(
      interaction.client.rest,
      guildId,
      logChannelId,
    );
    if (channelError) {
      await this.reply(interaction, channelError);
      return;
    }

    const settings = await this.guildRepo.upsert({
      guildId,
      logChannelId,
      ...SCREENING_DEFAULTS,
      rules: null,
      enabledBy: interaction.user.id,
      enabledAt: new Date(),
    });

    this.logger.info(
      { guildId, logChannelId, enabledBy: interaction.user.id },
      "Enabled member screening",
    );

    await this.reply(
      interaction,
      `Enabled member screening for \`${settings.guildId}\`, logging to <#${logChannelId}> with default settings.`,
    );
  }

  private async handleDisable(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const guildId = interaction.options.getString("guild_id", true).trim();

    if (!SNOWFLAKE_PATTERN.test(guildId)) {
      await this.reply(interaction, "`guild_id` must be a server ID.");
      return;
    }

    const deleted = await this.guildRepo.delete(guildId);
    if (!deleted) {
      await this.reply(interaction, `\`${guildId}\` isn't allowlisted.`);
      return;
    }

    this.logger.info(
      { guildId, disabledBy: interaction.user.id },
      "Disabled member screening",
    );

    await this.reply(
      interaction,
      `Disabled member screening for \`${guildId}\`.`,
    );
  }

  private async handleConfigure(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const guildId = interaction.options.getString("guild_id", true).trim();

    if (!SNOWFLAKE_PATTERN.test(guildId)) {
      await this.reply(interaction, "`guild_id` must be a server ID.");
      return;
    }

    // Read from the database, not the snapshot, so edits never start from stale settings.
    const current = (await this.guildRepo.list()).find(
      (s) => s.guildId === guildId,
    );
    if (!current) {
      await this.reply(
        interaction,
        `\`${guildId}\` isn't allowlisted. Use \`/member-screening enable\` first.`,
      );
      return;
    }

    const next: ScreeningGuildSettings = { ...current };

    const logChannelId = interaction.options
      .getString("log_channel_id")
      ?.trim();
    if (logChannelId?.toLowerCase() === "none") {
      next.logChannelId = null;
    } else if (logChannelId !== undefined) {
      const channelError = await validateLogChannel(
        interaction.client.rest,
        guildId,
        logChannelId,
      );
      if (channelError) {
        await this.reply(interaction, channelError);
        return;
      }
      next.logChannelId = logChannelId;
    }

    const rulesInput = interaction.options.getString("rules");
    if (rulesInput !== null) {
      const parsed = parseRules(rulesInput);
      if (!parsed.ok) {
        const invalid =
          parsed.invalid.length > 0
            ? `Unknown rules: ${parsed.invalid.join(", ")}. `
            : "";
        await this.reply(
          interaction,
          `${invalid}Valid rules: ${SCREENING_RULE_IDS.join(", ")}, or \`default\`.`,
        );
        return;
      }
      next.rules = parsed.rules;
    }

    const maxMessages = interaction.options.getInteger("max_messages");
    if (
      maxMessages !== null &&
      (maxMessages < 1 || maxMessages > MAX_MESSAGES_MAX)
    ) {
      await this.reply(
        interaction,
        `\`max_messages\` must be between 1 and ${MAX_MESSAGES_MAX}.`,
      );
      return;
    }
    const windowHours = interaction.options.getInteger("window_hours");
    if (
      windowHours !== null &&
      (windowHours < 1 || windowHours > WINDOW_HOURS_MAX)
    ) {
      await this.reply(
        interaction,
        `\`window_hours\` must be between 1 and ${WINDOW_HOURS_MAX}.`,
      );
      return;
    }

    next.maxMessages = maxMessages ?? next.maxMessages;
    next.windowHours = windowHours ?? next.windowHours;
    next.reviewThreshold =
      interaction.options.getNumber("review_threshold") ?? next.reviewThreshold;
    next.checkAvatars =
      interaction.options.getBoolean("check_avatars") ?? next.checkAvatars;
    next.dailyCheckCap =
      interaction.options.getInteger("daily_check_cap") ?? next.dailyCheckCap;

    await this.guildRepo.upsert(next);

    this.logger.info(
      { guildId, configuredBy: interaction.user.id },
      "Configured member screening",
    );

    await this.reply(
      interaction,
      `Updated member screening for \`${guildId}\`. Use \`/member-screening status\` to review.`,
    );
  }

  private async handleStatus(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const since = dayjs().utc().subtract(STATUS_WINDOW_DAYS, "day").toDate();
    const [settings, stats] = await Promise.all([
      this.guildRepo.list(),
      this.verdictRepo.statsSince(since),
    ]);

    const guildNames = new Map<string, string>();
    await Promise.all(
      settings.map(async (s) => {
        try {
          // REST, not guilds.fetch: the guild may live on another cluster and shouldn't enter this cache.
          const guild = (await interaction.client.rest.get(
            Routes.guild(s.guildId),
          )) as APIGuild;
          guildNames.set(s.guildId, guild.name);
        } catch (err) {
          // Best-effort: the view falls back to the guild ID.
          this.logger.debug(
            { err, guildId: s.guildId },
            "Failed to fetch screening guild name",
          );
        }
      }),
    );

    await interaction.editReply({
      components: [buildScreeningStatus(settings, stats, guildNames)],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
  }

  private async reply(
    interaction: ChatInputCommandInteraction,
    content: string,
  ): Promise<void> {
    await interaction.editReply({
      components: [
        new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(content),
        ),
      ],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
  }
}
