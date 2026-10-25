import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  TextDisplayBuilder,
} from "discord.js";
import type { InteractionReplyOptions } from "discord.js";

import type dayjs from "@/shared/domain/dayjs";
import Color from "@/utils/colors";

import { STREAK_MILESTONES } from "../../domain";
import type { FishyResult, RepResult, StreakUpdate } from "../../domain";
import type { FishingCondition } from "../../domain/collection/Catalog";
import { RARITY_COLORS, getCollectible } from "../../domain/collection/Catalog";

const CONDITION_COPY: Record<FishingCondition, { icon: string; text: string }> =
  {
    still: { icon: "🌊", text: "The water is calm." },
    light_rain: { icon: "🌧️", text: "A light rain is falling." },
    heavy_rain: { icon: "🌧️", text: "Heavy rain patters on the water." },
    mist: { icon: "🌫️", text: "Mist hangs over the water." },
    moonlit: { icon: "🌙", text: "Moonlight glimmers on the water." },
  };

// Fishy multiplies the catch, rep only gets a chance at bonus rep
function formatFishyReward(multiplier: number): string {
  return `${Number(multiplier.toFixed(2))}x`;
}

function formatRepReward(multiplier: number): string {
  return `${Math.round((multiplier - 1) * 100)}% bonus rep chance`;
}

function formatStreak(
  streak: StreakUpdate,
  name: string,
  formatReward: (multiplier: number) => string,
  bonus: string,
): string {
  let content = "";

  // A streak below the first milestone had no bonus, so losing it isn't worth a notice
  if (streak.brokenStreak && streak.brokenStreak >= STREAK_MILESTONES[0].days) {
    content += `-# 💔 You missed a day, so your **${streak.brokenStreak} day ${name} streak** ended. Starting over at day 1.\n`;
  }

  content += `-# ${streak.streak} day ${name} streak`;

  if (streak.multiplier > 1) {
    content += ` · ${formatReward(streak.multiplier)}${bonus}`;
  }

  if (streak.nextMilestone) {
    content += ` · next: ${formatReward(streak.nextMilestone.multiplier)} at ${streak.nextMilestone.label}`;
  }

  return content;
}

export function createFishySuccessMessage(
  result: FishyResult,
  targetUserId: string,
  artwork?: Buffer | string,
  conditionEmoji?: string,
): InteractionReplyOptions {
  const item = getCollectible(result.collectibleId);
  const condition = CONDITION_COPY[result.condition];
  const count = result.caughtAmount;
  const fishyWord = count === 1 ? "fishy" : "fishies";

  const text = new TextDisplayBuilder().setContent(
    `### ${result.firstDiscovery ? "New discovery: " : "You caught "}${item.name}\n` +
      `**${item.rarity.charAt(0).toUpperCase() + item.rarity.slice(1)}**\n` +
      `${conditionEmoji || condition.icon} ${condition.text}\n` +
      `${result.firstDiscovery ? "" : `You have caught this ${result.catchCount.toLocaleString()} times.\n`}\n` +
      `<@${targetUserId}> received **${count} ${fishyWord}** (${result.oldAmount} → ${result.newAmount}).\n` +
      formatStreak(
        result.streak,
        "fishy",
        formatFishyReward,
        ` (${result.baseAmount} → ${count})`,
      ),
  );
  const container = new ContainerBuilder().setAccentColor(
    RARITY_COLORS[item.rarity],
  );
  if (artwork)
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text)
        .setThumbnailAccessory((thumbnail) =>
          thumbnail
            .setURL(
              typeof artwork === "string" ? artwork : "attachment://catch.png",
            )
            .setDescription(item.name),
        ),
    );
  else container.addTextDisplayComponents(text);
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("fishycollection/open")
        .setLabel("Open collection")
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
    files:
      artwork && typeof artwork !== "string"
        ? [new AttachmentBuilder(artwork, { name: "catch.png" })]
        : [],
  };
}

export function createFishyCooldownMessage(
  nextFishyTime: dayjs.Dayjs,
): InteractionReplyOptions {
  const container = new ContainerBuilder()
    .setAccentColor(Color.Error)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `You can fishy again <t:${nextFishyTime.unix()}:R>`,
      ),
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

export function createRepSuccessMessage(
  result: RepResult,
  targetUserId: string,
): InteractionReplyOptions {
  const given = result.isStreakBonus ? `${result.amount} rep` : "a rep";
  const bonus = result.isStreakBonus ? " · bonus rep!" : "";

  const container = new ContainerBuilder()
    .setAccentColor(Color.Success)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `You gave <@${targetUserId}> ${given}! (${result.oldAmount} → ${result.newAmount} total)\n` +
          formatStreak(result.streak, "rep", formatRepReward, bonus),
      ),
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

export function createRepCooldownMessage(
  nextRepTime: dayjs.Dayjs,
): InteractionReplyOptions {
  const container = new ContainerBuilder()
    .setAccentColor(Color.Error)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `You can rep again <t:${nextRepTime.unix()}:R>`,
      ),
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}
