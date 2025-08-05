import { EmbedBuilder } from "discord.js";
import dayjs from "@/shared/domain/dayjs";
import toTimestamp from "@/utils/toTimestamp";
import Color from "@/utils/colors";

import { Giveaway } from "../../domain/entities/Giveaway";

export function buildGiveawayEmbed(
  giveaway: Giveaway,
  winnerIds: string[],
): EmbedBuilder {
  const endTime = dayjs.utc(giveaway.endAt);

  let desc = "";
  if (giveaway.isEnded) {
    desc += "Ended ";
  } else {
    desc += "Ends ";
  }

  desc += `${toTimestamp(endTime, "R")} ~ ${toTimestamp(endTime, "f")}`;
  desc += "\n\n";

  desc += `**Host:** <@!${giveaway.hostUserId}>`;
  desc += "\n";
  desc += `**Prize:** ${giveaway.prize}`;
  desc += "\n";

  if (winnerIds.length > 0) {
    const winnersStr = winnerIds.map((id) => `<@${id}>`).join(", ");

    desc += `**Winner${
      winnerIds.length > 1 ? "s" : ""
    }:** ${winnersStr}`;
  } else {
    desc += `**Winners:** ${giveaway.numWinners}`;
  }

  desc += "\n\n";

  let reqDesc = "";

  if (giveaway.requiredMinLevel) {
    reqDesc += `**Minimum Level:** ${giveaway.requiredMinLevel}\n`;
  }

  if (giveaway.requiredMaxLevel) {
    reqDesc += `**Maximum Level:** ${giveaway.requiredMaxLevel}\n`;
  }

  if (giveaway.requiredRoleId) {
    reqDesc += `**Role:** You need the <@&${giveaway.requiredRoleId}> role\n`;
  }

  if (giveaway.requiredBoosting === true) {
    reqDesc += "**Server Boosting:** You must be a server booster\n";
  } else if (giveaway.requiredBoosting === false) {
    reqDesc += "**Server Boosting:** You must not be a server booster\n";
  }

  if (giveaway.requiredNitroState === "nitro") {
    reqDesc += "**Nitro:** You must have Discord Nitro\n";
  } else if (giveaway.requiredNitroState === "none") {
    reqDesc += "**Nitro:** You must __not__ have Discord Nitro\n";
  }

  if (reqDesc.length === 0) {
    reqDesc = "There are no requirements to enter this giveaway!";
  }

  return new EmbedBuilder()
    .setTitle(`Giveaway - ${giveaway.prize}`)
    .setDescription(desc)
    .addFields({
      name: "Requirements",
      value: reqDesc,
    })
    .setColor(Color.Info)
    .setTimestamp(giveaway.startAt);
}