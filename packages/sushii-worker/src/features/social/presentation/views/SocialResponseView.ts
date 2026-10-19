import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";
import type { InteractionReplyOptions } from "discord.js";

import type dayjs from "@/shared/domain/dayjs";
import Color from "@/utils/colors";

import type { FishyResult, RepResult, StreakUpdate } from "../../domain";

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

  if (streak.brokenStreak) {
    content += `💔 You missed a day, so your **${streak.brokenStreak} day ${name} streak** ended. Starting over at day 1.\n`;
  }

  content += `-# 🔥 ${streak.streak} day ${name} streak`;

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
): InteractionReplyOptions {
  const count = result.caughtAmount;
  const fishyWord = count === 1 ? "fishy" : "fishies";

  const container = new ContainerBuilder()
    .setAccentColor(Color.Success)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `You caught a ${result.caughtType} for <@${targetUserId}> worth ${count} ${fishyWord}! (${result.oldAmount} → ${result.newAmount} total fishies)\n` +
          formatStreak(
            result.streak,
            "fishy",
            formatFishyReward,
            ` (${result.baseAmount} → ${count})`,
          ),
      ),
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
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
