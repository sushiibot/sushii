import {
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  TextDisplayBuilder,
} from "discord.js";
import type { InteractionReplyOptions } from "discord.js";

import type { UserRankData } from "../../application/GetUserRankService";

export function formatRankCard(
  data: UserRankData,
  avatarURL: string,
): InteractionReplyOptions {
  const { user, profile, guildLevel, globalLevel, rankings } = data;

  const guildProgressBar = guildLevel.getProgressBar().render();
  const globalProgressBar = globalLevel.getProgressBar().render();

  const content = `**${user.username}**
💗 **Rep**: ${profile.getReputation().toLocaleString()}   🐟 **Fishies**: ${profile.getFishies().toLocaleString()}  

**🌟 Server Level ${guildLevel.getCurrentLevel()}**
${guildProgressBar}
-# ${guildLevel.getXpDisplayText()}

🏆 **Server Rankings**
> **All Time**: 
> \`${rankings.getAllTimeRank().getFormattedPosition()}\`
> **Day**: 
> \`${rankings.getDayRank().getFormattedPosition()}\`
> **Week**: 
> \`${rankings.getWeekRank().getFormattedPosition()}\`
> **Month**: 
> \`${rankings.getMonthRank().getFormattedPosition()}\`

**🌏 Global Level ${globalLevel.getCurrentLevel()}**  
${globalProgressBar}
-# ${globalLevel.getXpDisplayText()}
`;

  // ---------------------------------------------------------------------------
  // Build section with both the avatar and the content
  const textContent = new TextDisplayBuilder().setContent(content);

  const section = new SectionBuilder()
    .setThumbnailAccessory((b) => b.setURL(avatarURL))
    .addTextDisplayComponents(textContent);

  // Build container with section
  const container = new ContainerBuilder().addSectionComponents(section);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
