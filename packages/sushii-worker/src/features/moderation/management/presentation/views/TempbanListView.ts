import type { APIEmbed } from "discord.js";

import type { TempBanListItem } from "@/features/moderation/management/application/TempBanListService";
import Color from "@/utils/colors";

export function tempBanListEmptyView(): APIEmbed {
  return {
    title: "Temporary Bans",
    description: "There are no active temporary bans.",
    color: Color.Info,
  };
}

export function tempBanListErrorView(): APIEmbed {
  return {
    title: "Error",
    description: "Failed to retrieve temporary ban list.",
    color: Color.Error,
  };
}

export function tempBanListView(
  tempBans: TempBanListItem[],
  pageIndex: number = 0,
  _totalPages: number = 1,
): APIEmbed {
  const title =
    pageIndex === 0
      ? `Temporary Bans (${tempBans.length})`
      : `Temporary Bans (continued)`;

  const description = formatTempBanList(tempBans);

  return {
    title,
    description,
    color: Color.Info,
  };
}

export function formatTempBanList(items: TempBanListItem[]): string {
  return items
    .map((item) => {
      let s = `${item.userMention} (ID: \`${item.userId}\`)`;
      s += `\n╰ Expires: ${item.expiresTimestamp}`;
      s += `\n╰ Started: ${item.startTimestamp}`;
      return s;
    })
    .join("\n\n");
}

export function chunkTempBansByLength(
  tempBans: TempBanListItem[],
  maxLength: number = 4096,
): TempBanListItem[][] {
  const chunks: TempBanListItem[][] = [];
  let currentChunk: TempBanListItem[] = [];
  let currentLength = 0;

  for (const tempBan of tempBans) {
    const itemText = `${tempBan.userMention} (ID: \`${tempBan.userId}\`)\n╰ Expires: ${tempBan.expiresTimestamp}\n╰ Started: ${tempBan.startTimestamp}\n\n`;

    if (
      currentLength + itemText.length > maxLength &&
      currentChunk.length > 0
    ) {
      chunks.push(currentChunk);
      currentChunk = [tempBan];
      currentLength = itemText.length;
    } else {
      currentChunk.push(tempBan);
      currentLength += itemText.length;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}
