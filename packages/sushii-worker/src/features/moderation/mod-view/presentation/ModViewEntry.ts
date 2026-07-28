import type { Guild, GuildMember, User } from "discord.js";
import type { Logger } from "pino";

import type { SetNicknameService } from "@/features/alt-accounts/application/SetNicknameService";
import type { BotEmojiRepository } from "@/features/bot-emojis";
import { HISTORY_ACTION_EMOJIS } from "@/features/moderation/cases/presentation/views/HistoryView";
import { getErrorMessage } from "@/interactions/responses/error";

import type { ModViewService } from "../application/ModViewService";
import type { ModViewEntryInteraction } from "./ModViewSession";
import { ModViewSession } from "./ModViewSession";
import type { ModViewTab } from "./views/components/ModViewChrome";

export interface ModViewDependencies {
  modViewService: ModViewService;
  emojiRepository: BotEmojiRepository;
  setNicknameService: SetNicknameService;
  logger: Logger;
}

/**
 * Resolves the target's member once at entry. Held for the session rather
 * than re-fetched per tab: a `ButtonInteraction` cannot re-resolve it, and a
 * fetch per navigation adds a fallible round-trip to every click.
 */
export async function fetchTargetMember(
  guild: Guild,
  userId: string,
  logger: Logger,
): Promise<GuildMember | null> {
  try {
    return await guild.members.fetch(userId);
  } catch (err) {
    logger.debug({ err, userId }, "Mod view target is not a guild member");
    return null;
  }
}

/**
 * Loads the view's data and opens the session. Throws on infrastructure
 * failure — the entry points catch and respond, per the layering rule that
 * only presentation handles a throw.
 */
export async function openModView(
  interaction: ModViewEntryInteraction,
  targetUser: User,
  deps: ModViewDependencies,
  initialTab: ModViewTab = "overview",
  ephemeral = false,
): Promise<void> {
  const member = await fetchTargetMember(
    interaction.guild,
    targetUser.id,
    deps.logger,
  );

  const result = await deps.modViewService.getModView(
    interaction.guildId,
    targetUser.id,
    member,
  );

  if (!result.ok) {
    await interaction.reply(
      getErrorMessage("Failed to open mod view", result.val, true),
    );
    return;
  }

  const emojis = await deps.emojiRepository.getEmojis(HISTORY_ACTION_EMOJIS);

  const session = new ModViewSession(
    interaction,
    result.val,
    targetUser,
    member,
    emojis,
    deps.setNicknameService,
    deps.logger,
    initialTab,
    ephemeral,
  );

  await session.start();
}

/** Single error response for a thrown failure, at whichever stage it happened. */
export async function respondWithModViewError(
  interaction: ModViewEntryInteraction,
  description: string,
): Promise<void> {
  const message = getErrorMessage("Failed to open mod view", description, true);

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(message);
    return;
  }

  await interaction.reply(message);
}

/**
 * Shared entry-point wrapper for every deep-linking command: opens the view
 * on the given tab and converts a thrown infrastructure error into a reply,
 * per the layering rule that only presentation handles a throw.
 */
export async function openModViewOrReportError(
  interaction: ModViewEntryInteraction,
  targetUser: User,
  deps: ModViewDependencies,
  initialTab: ModViewTab,
  ephemeral = false,
): Promise<void> {
  const log = deps.logger.child({
    guildId: interaction.guildId,
    targetId: targetUser.id,
    executorId: interaction.user.id,
  });

  try {
    await openModView(interaction, targetUser, deps, initialTab, ephemeral);
  } catch (err) {
    log.error({ err }, "Failed to open mod view");
    await respondWithModViewError(
      interaction,
      "Something went wrong loading this user's moderation data.",
    );
  }
}
