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
import SushiiEmoji from "@/shared/presentation/SushiiEmoji";

import type { InviteInfo } from "../../application/InviteInfoService";

const MAX_DESCRIPTION_LENGTH = 120;
const MAX_INVITES_DISPLAYED = 5;

function formatInviteMain(invite: InviteInfo): string {
  const lines: string[] = [];

  lines.push(`**${invite.guildName}**`);

  const statsAndBadges: string[] = [];
  if (invite.presenceCount !== null) {
    statsAndBadges.push(`${invite.presenceCount.toLocaleString()} online`);
  }
  if (invite.memberCount !== null) {
    statsAndBadges.push(`${invite.memberCount.toLocaleString()} members`);
  }
  if (invite.isVerified) statsAndBadges.push(`${SushiiEmoji.VerifiedIcon} Verified`);
  if (invite.isPartnered) statsAndBadges.push(`${SushiiEmoji.PartnerIcon} Partnered`);
  if (statsAndBadges.length > 0) {
    lines.push(`-# ${statsAndBadges.join(" · ")}`);
  }

  if (invite.guildDescription) {
    const desc =
      invite.guildDescription.length > MAX_DESCRIPTION_LENGTH
        ? `${invite.guildDescription.slice(0, MAX_DESCRIPTION_LENGTH - 3)}...`
        : invite.guildDescription;
    lines.push(`> ${desc}`);
  }

  return lines.join("\n");
}

function formatInviteMeta(invite: InviteInfo): string {
  const meta: string[] = [`\`discord.gg/${invite.code}\``];
  if (invite.channelName) meta.push(`\`#${invite.channelName}\``);
  if (invite.guildId) meta.push(`Server ID: \`${invite.guildId}\``);
  return `-# ${meta.join(" · ")}`;
}

export function buildInviteInfoReply(
  invites: InviteInfo[],
): MessageCreateOptions & { flags: MessageFlags.IsComponentsV2 } {
  const displayInvites = invites.slice(0, MAX_INVITES_DISPLAYED);
  const overflow = invites.length - displayInvites.length;

  const container = new ContainerBuilder().setAccentColor(Color.Info);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# Invite Server Info`),
  );

  for (const [i, invite] of displayInvites.entries()) {
    if (i > 0) {
      container.addSeparatorComponents(new SeparatorBuilder());
    }

    const mainText = formatInviteMain(invite);

    if (invite.guildIconURL) {
      container.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(mainText))
          .setThumbnailAccessory(
            new ThumbnailBuilder().setURL(invite.guildIconURL),
          ),
      );
    } else {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(mainText),
      );
    }

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(formatInviteMeta(invite)),
    );
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
