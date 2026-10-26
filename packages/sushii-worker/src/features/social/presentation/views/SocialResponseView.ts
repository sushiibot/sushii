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

import { ACTIVE_DAYS_WINDOW } from "../../domain";
import type { ActiveDaysSummary, FishyResult, RepResult } from "../../domain";
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

function formatBonusPercent(multiplier: number): number {
  return Math.round((multiplier - 1) * 100);
}

function formatActiveDays(activity: ActiveDaysSummary, action: string): string {
  return `${action} ${activity.activeDays} of the last ${ACTIVE_DAYS_WINDOW} days`;
}

function formatFishyActivity(result: FishyResult): string {
  const { activity } = result;
  let content = `-# 🎣 ${formatActiveDays(activity, "Fished")}`;

  if (activity.multiplier > 1) {
    content += ` · +${formatBonusPercent(activity.multiplier)}% fishies`;
  }

  // Small bonuses can round away, so only show the change when there is one
  if (result.caughtAmount !== result.baseAmount) {
    content += ` (${result.baseAmount} → ${result.caughtAmount})`;
  }

  return content;
}

function formatRepActivity(result: RepResult): string {
  const { activity } = result;
  let content = `-# 💝 ${formatActiveDays(activity, "Gave rep")}`;

  if (activity.multiplier > 1) {
    content += ` · ${formatBonusPercent(activity.multiplier)}% chance of bonus rep`;
  }

  if (result.isBonus) {
    content += " · bonus rep!";
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
      formatFishyActivity(result),
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
  const given = result.isBonus ? `${result.amount} rep` : "a rep";

  const container = new ContainerBuilder()
    .setAccentColor(Color.Success)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `You gave <@${targetUserId}> ${given}! (${result.oldAmount} → ${result.newAmount} total)\n` +
          formatRepActivity(result),
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
