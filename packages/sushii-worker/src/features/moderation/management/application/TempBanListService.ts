import type { Logger } from "pino";

import type { TempBan } from "../../shared/domain/entities/TempBan";
import type { TempBanRepository } from "../../shared/domain/repositories/TempBanRepository";

export interface TempBanListItem {
  userId: string;
  userMention: string;
  startTimestamp: string;
  expiresTimestamp: string;
  createdAt: Date;
  expiresAt: Date;
}

export class TempBanListService {
  constructor(
    private readonly tempBanRepository: TempBanRepository,
    private readonly logger: Logger,
  ) {}

  async getActiveTempBans(guildId: string): Promise<TempBanListItem[]> {
    this.logger.debug({ guildId }, "Getting active temp bans for guild");

    const tempBans = await this.tempBanRepository.findByGuildId(guildId);

    this.logger.debug(
      { guildId, count: tempBans.length },
      "Retrieved temp bans from repository",
    );

    const listItems = tempBans.map((tempBan) => this.formatTempBan(tempBan));

    // Sort by expiration time (earliest first)
    listItems.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());

    return listItems;
  }

  private formatTempBan(tempBan: TempBan): TempBanListItem {
    const userMention = `<@${tempBan.userId}>`;
    const createdAtDate = tempBan.createdAt.toDate();
    const expiresAtDate = tempBan.expiresAt.toDate();
    const startTimestamp = this.formatTimestamp(createdAtDate, "f");
    const expiresTimestamp = this.formatTimestamp(expiresAtDate, "R");

    return {
      userId: tempBan.userId,
      userMention,
      startTimestamp,
      expiresTimestamp,
      createdAt: createdAtDate,
      expiresAt: expiresAtDate,
    };
  }

  private formatTimestamp(date: Date, style: "f" | "R"): string {
    const timestamp = Math.floor(date.getTime() / 1000);
    return `<t:${timestamp}:${style}>`;
  }

  formatTempBanList(items: TempBanListItem[]): string {
    return items
      .map((item) => {
        let s = `${item.userMention} (ID: \`${item.userId}\`)`;
        s += `\n╰ Expires: ${item.expiresTimestamp}`;
        s += `\n╰ Started: ${item.startTimestamp}`;
        return s;
      })
      .join("\n\n");
  }
}
