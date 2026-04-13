import type { Client } from "discord.js";
import type { Logger } from "pino";

export interface InviteInfo {
  code: string;
  guildId: string | null;
  guildName: string;
  guildDescription: string | null;
  guildIconURL: string | null;
  channelName: string | null;
  memberCount: number | null;
  presenceCount: number | null;
  isVerified: boolean;
  isPartnered: boolean;
}

// Matches discord.gg/CODE, discord.com/invite/CODE, discordapp.com/invite/CODE
const INVITE_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([A-Za-z0-9-]+)/gi;

export class InviteInfoService {
  constructor(
    private readonly client: Client,
    private readonly logger: Logger,
  ) {}

  extractInviteCodes(content: string): string[] {
    const codes = new Set<string>();
    let match;
    const regex = new RegExp(INVITE_REGEX.source, "gi");
    while ((match = regex.exec(content)) !== null) {
      codes.add(match[1]);
    }
    return [...codes];
  }

  async fetchInviteInfo(code: string): Promise<InviteInfo | null> {
    try {
      const invite = await this.client.fetchInvite(code);
      return {
        code,
        guildId: invite.guild?.id ?? null,
        guildName: invite.guild?.name ?? "Unknown Server",
        guildDescription: invite.guild?.description ?? null,
        guildIconURL: invite.guild?.iconURL({ size: 256 }) ?? null,
        channelName: invite.channel?.name ?? null,
        memberCount: invite.memberCount,
        presenceCount: invite.presenceCount,
        isVerified: invite.guild?.verified ?? false,
        isPartnered: invite.guild?.partnered ?? false,
      };
    } catch (err) {
      this.logger.warn({ err, inviteCode: code }, "Failed to fetch invite info");
      return null;
    }
  }

  async fetchInviteInfos(codes: string[]): Promise<InviteInfo[]> {
    const results = await Promise.all(
      codes.map((code) => this.fetchInviteInfo(code)),
    );
    return results.filter((r): r is InviteInfo => r !== null);
  }
}
