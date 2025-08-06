import { EmbedBuilder } from "discord.js";

import Color from "@/utils/colors";

import { PruneResult } from "../../application/PruneMessageService";

function generateRangeDescription(
  afterMessageID: string | null,
  beforeMessageID: string | null,
): string | null {
  if (afterMessageID && beforeMessageID) {
    return `${afterMessageID} to ${beforeMessageID}`;
  }

  if (afterMessageID && !beforeMessageID) {
    return `After ${afterMessageID}`;
  }

  if (!afterMessageID && beforeMessageID) {
    return `Before ${beforeMessageID}`;
  }

  return null;
}

export function pruneSuccessView(result: PruneResult): EmbedBuilder {
  const { deletedCount, userDeletedSummary, afterMessageID, beforeMessageID } =
    result;

  const fields = [];

  const rangeDescription = generateRangeDescription(
    afterMessageID,
    beforeMessageID,
  );
  if (rangeDescription) {
    fields.push({
      name: "Range",
      value: rangeDescription,
    });
  }

  if (Object.keys(userDeletedSummary).length > 0) {
    fields.push({
      name: "Deleted messages sent by",
      value: Object.entries(userDeletedSummary)
        .map(([userID, count]) => `<@${userID}> - ${count}`)
        .join("\n"),
    });
  }

  return new EmbedBuilder()
    .setTitle(`Deleted ${deletedCount} messages`)
    .addFields(fields)
    .setColor(Color.Success);
}

export function pruneErrorView(error: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("Failed to prune messages")
    .setDescription(error)
    .setColor(Color.Error);
}
