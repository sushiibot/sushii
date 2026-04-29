import { sleep } from "bun";
import type { ChatInputCommandInteraction } from "discord.js";
import { PermissionFlagsBits } from "discord.js";
import type { Logger } from "pino";

import type { GuildChangelogPromptData } from "../domain/GuildChangelogPrompt";
import type { ChangelogPromptRepository } from "../domain/repositories/ChangelogPromptRepository";
import { ENABLED_GUILD_IDS, SNOOZE_DAYS } from "../presentation/ChangelogPromptConstants";
import { buildChangelogPromptMessage } from "../presentation/views/ChangelogPromptMessageBuilder";

const MOD_PERMISSIONS =
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.ModerateMembers;

const PROMPT_DELAY_MS = 2000;

export class ChangelogPromptService {
  constructor(
    private readonly repository: ChangelogPromptRepository,
    private readonly logger: Logger,
  ) {}

  async maybePrompt(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
    try {
      await this.doMaybePrompt(interaction);
    } catch (error) {
      this.logger.error(
        { err: error, guildId: interaction.guildId },
        "Failed to show changelog prompt",
      );
    }
  }

  private async doMaybePrompt(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    if (!ENABLED_GUILD_IDS.has(interaction.guildId)) {
      return;
    }

    // Only for users with mod permissions
    if (!interaction.memberPermissions.any(MOD_PERMISSIONS)) {
      return;
    }

    // Only in private channels (not visible to @everyone)
    const channel = interaction.channel;
    if (!channel || !channel.isTextBased()) {
      return;
    }

    const everyonePermissions = channel.permissionsFor(interaction.guild.roles.everyone);
    if (everyonePermissions?.has(PermissionFlagsBits.ViewChannel)) {
      return;
    }

    const guildId = BigInt(interaction.guildId);
    const prompt = await this.repository.findByGuildId(guildId);

    if (!this.shouldShowPrompt(prompt)) {
      return;
    }

    await this.repository.upsert({
      guildId,
      lastPromptedAt: new Date(),
      snoozeUntil: prompt?.snoozeUntil ?? null,
      dismissedAt: prompt?.dismissedAt ?? null,
      followedAt: prompt?.followedAt ?? null,
    });

    const botHasManageWebhooks =
      interaction.guild.members.me?.permissions.has(PermissionFlagsBits.ManageWebhooks) ?? false;

    await sleep(PROMPT_DELAY_MS);

    await interaction.followUp(buildChangelogPromptMessage(botHasManageWebhooks));
  }

  private shouldShowPrompt(prompt: GuildChangelogPromptData | null): boolean {
    if (!prompt) {
      return true;
    }
    if (prompt.followedAt) {
      return false;
    }
    if (prompt.dismissedAt) {
      return false;
    }
    if (prompt.snoozeUntil && prompt.snoozeUntil > new Date()) {
      return false;
    }
    if (prompt.lastPromptedAt) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (prompt.lastPromptedAt >= today) {
        return false;
      }
    }
    return true;
  }

  async recordFollowed(guildId: bigint): Promise<void> {
    const existing = await this.repository.findByGuildId(guildId);
    await this.repository.upsert({
      guildId,
      lastPromptedAt: existing?.lastPromptedAt ?? null,
      snoozeUntil: null,
      dismissedAt: null,
      followedAt: new Date(),
    });
  }

  async recordSnoozed(guildId: bigint): Promise<void> {
    const existing = await this.repository.findByGuildId(guildId);
    const snoozeUntil = new Date();
    snoozeUntil.setDate(snoozeUntil.getDate() + SNOOZE_DAYS);
    await this.repository.upsert({
      guildId,
      lastPromptedAt: existing?.lastPromptedAt ?? null,
      snoozeUntil,
      dismissedAt: null,
      followedAt: null,
    });
  }

  async recordDismissed(guildId: bigint): Promise<void> {
    const existing = await this.repository.findByGuildId(guildId);
    await this.repository.upsert({
      guildId,
      lastPromptedAt: existing?.lastPromptedAt ?? null,
      snoozeUntil: null,
      dismissedAt: new Date(),
      followedAt: null,
    });
  }
}
