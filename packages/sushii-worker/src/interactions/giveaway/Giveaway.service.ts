import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  GuildTextBasedChannel,
} from "discord.js";
import {
  createGiveawayEntries,
  getGiveawayEntry,
  getGiveawayEntryCount,
  getRandomGiveawayEntries,
  markGiveawayEntriesAsPicked,
} from "../../db/Giveaway/Giveaway.repository";
import { GiveawayRow } from "../../db/Giveaway/Giveaway.table";
import db from "../../infrastructure/database/db";
import { getUserGuildLevel } from "../../db/UserLevel/UserLevel.repository";
import { calculateLevel } from "@/shared/domain/utils/LevelCalculations";
import { GiveawayOption } from "./Giveaway.options";
import Color from "../../utils/colors";
import { getGiveawayEmbed } from "./Giveaway.embed";
import { getGiveawayComponents } from "./Giveaway.components";

export async function getGiveawayChannelFromInteraction(
  interaction: ChatInputCommandInteraction<"cached">,
  giveaway: GiveawayRow,
): Promise<GuildTextBasedChannel> {
  if (giveaway.channel_id === interaction.channelId) {
    if (!interaction.channel) {
      throw new Error("No channel in interaction");
    }

    return interaction.channel;
  }

  const channel = await interaction.guild.channels.fetch(giveaway.channel_id);

  if (!channel) {
    throw new Error("Giveaway channel not found");
  }

  if (!channel.isTextBased()) {
    throw new Error("Giveaway channel is not a text channel");
  }

  return channel;
}

export async function rollGiveaway(
  giveawayId: string,
  allowRepeatWinners: boolean,
  winnerCount = 1,
): Promise<string[]> {
  const winners = await getRandomGiveawayEntries(
    db,
    giveawayId,
    allowRepeatWinners,
    winnerCount,
  );

  // No entries
  if (winners.length === 0) {
    return [];
  }

  await markGiveawayEntriesAsPicked(
    db,
    giveawayId,
    winners.map((w) => w.user_id),
  );

  return winners.map((w) => w.user_id);
}

export async function sendGiveawayWinnersMessage(
  giveawayChannel: GuildTextBasedChannel,
  giveaway: GiveawayRow,
  winnerIds: string[],
): Promise<void> {
  const winnersStr = winnerIds.map((id) => `<@${id}>`).join(", ");
  await giveawayChannel.send({
    content: `Congratulations to ${winnersStr}! You won: **${giveaway.prize}**`,
    reply: {
      messageReference: giveaway.id,
    },
  });
}

export async function endGiveaway(
  giveawayChannel: GuildTextBasedChannel,
  giveawayId: string,
  giveaway: GiveawayRow,
  allowRepeatWinners: boolean,
  wantWinnerCount: number,
): Promise<{
  embed: EmbedBuilder | null;
  winnerIds: string[];
}> {
  const winnerIds = await rollGiveaway(
    giveawayId,
    allowRepeatWinners || false,
    wantWinnerCount,
  );
  if (winnerIds.length === 0) {
    return {
      embed: new EmbedBuilder()
        .setTitle("No winners found")
        .setDescription(
          "There were no eligible entries for this giveaway. Do you want to include previously picked users? Run this command again with the **Allow repeat winners** option set to **true**",
        ),
      winnerIds: [],
    };
  }

  await sendGiveawayWinnersMessage(giveawayChannel, giveaway, winnerIds);

  if (winnerIds.length >= wantWinnerCount) {
    // Shouldn't be greater than wantwinnerCount but yes
    return {
      embed: null,
      winnerIds,
    };
  }

  const entryCount = await getGiveawayEntryCount(db, giveawayId);
  let desc;

  if (entryCount < wantWinnerCount) {
    desc = `There's ${wantWinnerCount} total desired winners but only ${entryCount} entries, so only ${entryCount} winners were picked.`;
  } else {
    desc = `There's ${wantWinnerCount} total desired winners but, only ${winnerIds.length} winners were picked.`;
    desc += ` Some users are excluded since they were previously picked, but you can run this command again with the **${GiveawayOption.AllowRepeatWinners}** option set to **true** to include them.`;
  }

  const embed = new EmbedBuilder()
    .setColor(Color.Warning)
    .setTitle("Not enough winners found")
    .setDescription(desc);

  return {
    embed,
    winnerIds,
  };
}

export async function updateGiveawayMessage(
  channel: GuildTextBasedChannel,
  giveaway: GiveawayRow,
  winnerIds: string[],
): Promise<void> {
  const totalEntries = await getGiveawayEntryCount(db, giveaway.id);

  const embed = getGiveawayEmbed(giveaway, winnerIds);
  const components = getGiveawayComponents(totalEntries, giveaway.is_ended);

  await channel.messages.edit(giveaway.id, {
    embeds: [embed],
    components,
  });
}

type GiveawayEligibility =
  | {
      eligible: true;
    }
  | {
      eligible: false;
      reason: string;
    };

export async function isEligibleForGiveaway(
  giveaway: GiveawayRow,
  member: GuildMember,
): Promise<GiveawayEligibility> {
  const guildLevel = await getUserGuildLevel(db, giveaway.guild_id, member.id);

  const allTimeXP = guildLevel ? BigInt(guildLevel.msg_all_time) : 0n;
  const userLevel = calculateLevel(allTimeXP);

  if (giveaway.required_min_level !== null) {
    if (userLevel < giveaway.required_min_level) {
      return {
        eligible: false,
        reason: `You need to be at least level ${giveaway.required_min_level}`,
      };
    }
  }

  if (giveaway.required_max_level !== null) {
    if (userLevel > giveaway.required_max_level) {
      return {
        eligible: false,
        reason: `You need to be at most level ${giveaway.required_max_level}`,
      };
    }
  }

  if (giveaway.required_role_id !== null) {
    if (!member.roles.cache.has(giveaway.required_role_id)) {
      return {
        eligible: false,
        reason: `You need the <@&${giveaway.required_role_id}> role`,
      };
    }
  }

  if (giveaway.required_boosting !== null) {
    if (giveaway.required_boosting === true && !member.premiumSince) {
      return {
        eligible: false,
        reason: "You need to be a server booster",
      };
    }

    if (giveaway.required_boosting === false && member.premiumSince) {
      return {
        eligible: false,
        reason: "You need to __not__ be a server booster",
      };
    }
  }

  return {
    eligible: true,
  };
}

export async function enterGiveaway(
  giveawayId: string,
  userId: string,
): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const existingEntry = await getGiveawayEntry(trx, giveawayId, userId);
    if (existingEntry) {
      return false;
    }

    await createGiveawayEntries(trx, [
      {
        giveaway_id: giveawayId,
        user_id: userId,
      },
    ]);
    return true;
  });
}
