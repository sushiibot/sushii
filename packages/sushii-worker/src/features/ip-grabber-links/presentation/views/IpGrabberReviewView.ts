import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "discord.js";

import Color from "@/utils/colors";

import type { IpGrabberDomain } from "../../domain/IpGrabberRepository";
import { IP_GRABBER_PROVIDERS } from "../../domain/providers";
import { buildRevertId } from "./ipGrabberCustomIds";

const MATCHED: Record<IpGrabberDomain["provider"], string> = {
  grabify: "`asuid` TXT record is Grabify's Azure ID",
  iplogger: "Cloudflare nameservers, home page redirects to `iplogger.org`",
};

function firstSeen(domain: IpGrabberDomain): string {
  if (domain.source === "endpoint") {
    return "Grabify's published domain list";
  }

  const guild =
    domain.firstSeenGuildName ?? domain.firstSeenGuildId ?? "unknown server";
  const channel = domain.firstSeenChannelName
    ? ` · #${domain.firstSeenChannelName}`
    : "";
  return `${guild}${channel}`;
}

export function buildIpGrabberReviewMessage(
  domain: IpGrabberDomain,
  resolved?: { userId: string; at: Date },
) {
  const createdAt = Math.floor(domain.createdAt.getTime() / 1000);
  const status = resolved
    ? `*Reverted by <@${resolved.userId}> <t:${Math.floor(resolved.at.getTime() / 1000)}:R>* · removed from all rules on the next sync, won't be re-added`
    : `Added <t:${createdAt}:R> · goes into servers' rules on the next sync`;

  const button = new ButtonBuilder()
    .setCustomId(buildRevertId(domain.hostname))
    .setLabel(resolved ? "Reverted" : "Revert")
    .setStyle(resolved ? ButtonStyle.Secondary : ButtonStyle.Danger)
    .setDisabled(!!resolved);

  const container = new ContainerBuilder()
    .setAccentColor(resolved ? Color.DiscordGrey : Color.Error)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### New IP grabber domain\n**\`${domain.hostname}\`** · ${IP_GRABBER_PROVIDERS[domain.provider].name}`,
      ),
      new TextDisplayBuilder().setContent(
        `**Matched** · ${MATCHED[domain.provider]}\n**First seen** · ${firstSeen(domain)}`,
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`-# ${status}`),
        )
        .setButtonAccessory(button),
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 as const,
    allowedMentions: { parse: [] },
  };
}
