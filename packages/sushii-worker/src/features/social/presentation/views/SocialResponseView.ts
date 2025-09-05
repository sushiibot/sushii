import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";
import type { InteractionReplyOptions } from "discord.js";

import type dayjs from "@/shared/domain/dayjs";
import Color from "@/utils/colors";

import type { FishyResult, RepResult } from "../../domain";

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
        `You caught a ${result.caughtType} for <@${targetUserId}> worth ${count} ${fishyWord}! (${result.oldAmount} → ${result.newAmount} total fishies)`,
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
  const container = new ContainerBuilder()
    .setAccentColor(Color.Success)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `You gave <@${targetUserId}> a rep! (${result.oldAmount} → ${result.newAmount} total)`,
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
