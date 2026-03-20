import {
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  TextDisplayBuilder,
} from "discord.js";
import type { InteractionReplyOptions } from "discord.js";

import type { BotEmojiNameType, EmojiMap } from "@/features/bot-emojis/domain";

import type { UserRankData } from "../../application/GetUserRankService";

export const RANK_CARD_EMOJIS = [
  "rep",
  "fishies",
  "level_server",
  "level_global",
  "rankings",
] as const satisfies readonly BotEmojiNameType[];

export function formatRankCard(
  data: UserRankData,
  avatarURL: string,
  emojis: EmojiMap<typeof RANK_CARD_EMOJIS>,
): InteractionReplyOptions {
  const { user, profile, guildLevel, globalLevel, rankings } = data;

  const guildProgressBar = guildLevel.getProgressBar().render();
  const globalProgressBar = globalLevel.getProgressBar().render();

  const content = `**${user.username}**
${emojis.rep} **Rep**: ${profile.getReputation().toLocaleString()}   ${emojis.fishies} **Fishies**: ${profile.getFishies().toLocaleString()}

${emojis.level_server} **Server Level ${guildLevel.getCurrentLevel()}**
${guildProgressBar}
-# ${guildLevel.getXpDisplayText()}

${emojis.rankings} **Server Rankings**
> **All Time**: \`${rankings.getAllTimeRank().getFormattedPosition()}\`
> **Day**: \`${rankings.getDayRank().getFormattedPosition()}\`
> **Week**: \`${rankings.getWeekRank().getFormattedPosition()}\`
> **Month**: \`${rankings.getMonthRank().getFormattedPosition()}\`

${emojis.level_global} **Global Level ${globalLevel.getCurrentLevel()}**
${globalProgressBar}
-# ${globalLevel.getXpDisplayText()}
`;

  const textContent = new TextDisplayBuilder().setContent(content);

  const section = new SectionBuilder()
    .setThumbnailAccessory((b) => b.setURL(avatarURL))
    .addTextDisplayComponents(textContent);

  const container = new ContainerBuilder().addSectionComponents(section);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
