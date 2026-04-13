import {
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  type MessageCreateOptions,
} from "discord.js";

import Color from "@/utils/colors";

import type { InviteInfo } from "../../application/InviteInfoService";

const MAX_DESCRIPTION_LENGTH = 120;
const MAX_INVITES_DISPLAYED = 5;

function formatInviteSection(invite: InviteInfo): string {
  const lines: string[] = [];

  lines.push(`**${invite.guildName}**`);

  const badges: string[] = [];
  if (invite.isVerified) badges.push("✅ Verified");
  if (invite.isPartnered) badges.push("💎 Partnered");
  if (badges.length > 0) {
    lines.push(badges.join(" · "));
  }

  if (invite.guildDescription) {
    const desc =
      invite.guildDescription.length > MAX_DESCRIPTION_LENGTH
        ? `${invite.guildDescription.slice(0, MAX_DESCRIPTION_LENGTH - 3)}...`
        : invite.guildDescription;
    lines.push(desc);
  }

  const stats: string[] = [];
  if (invite.memberCount !== null) {
    stats.push(`👥 ${invite.memberCount.toLocaleString()} members`);
  }
  if (invite.presenceCount !== null) {
    stats.push(`🟢 ${invite.presenceCount.toLocaleString()} online`);
  }
  if (stats.length > 0) {
    lines.push(stats.join(" · "));
  }

  const meta: string[] = [`[discord.gg/${invite.code}](https://discord.gg/${invite.code})`];
  if (invite.channelName) meta.push(`#${invite.channelName}`);
  if (invite.guildId) meta.push(`ID: ${invite.guildId}`);
  lines.push(`-# ${meta.join(" · ")}`);

  return lines.join("\n");
}

export function buildInviteInfoReply(
  invites: InviteInfo[],
): MessageCreateOptions & { flags: MessageFlags.IsComponentsV2 } {
  const displayInvites = invites.slice(0, MAX_INVITES_DISPLAYED);
  const overflow = invites.length - displayInvites.length;

  const container = new ContainerBuilder().setAccentColor(Color.Info);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `-# Invite Server Info`,
    ),
  );

  for (const [i, invite] of displayInvites.entries()) {
    if (i > 0) {
      container.addSeparatorComponents(new SeparatorBuilder());
    }

    const text = formatInviteSection(invite);

    if (invite.guildIconURL) {
      container.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
          .setThumbnailAccessory(
            new ThumbnailBuilder().setURL(invite.guildIconURL),
          ),
      );
    } else {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(text),
      );
    }
  }

  if (overflow > 0) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# +${overflow} more invite${overflow > 1 ? "s" : ""}`,
      ),
    );
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
