import { EmbedBuilder } from "discord.js";
import dayjs from "@/shared/domain/dayjs";
import Color from "@/utils/colors";
import { FishyResult, RepResult } from "../../domain";

export function createFishySuccessEmbed(
  result: FishyResult,
  targetUsername: string,
): EmbedBuilder {
  const count = result.caughtAmount;
  const fishyWord = count === 1 ? "fishy" : "fishies";
  
  return new EmbedBuilder()
    .setColor(Color.Success)
    .setDescription(
      `You caught a ${result.caughtType} for ${targetUsername} worth ${count} ${fishyWord}! (${result.oldAmount} → ${result.newAmount} total fishies)`
    );
}

export function createFishyCooldownEmbed(
  nextFishyTime: dayjs.Dayjs,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Color.Error)
    .setDescription(
      `You can fishy again <t:${nextFishyTime.unix()}:R>`
    );
}

export function createRepSuccessEmbed(
  result: RepResult,
  targetUsername: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Color.Success)
    .setDescription(
      `You gave ${targetUsername} a rep! (${result.oldAmount} → ${result.newAmount} total)`
    );
}

export function createRepCooldownEmbed(
  nextRepTime: dayjs.Dayjs,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Color.Error)
    .setDescription(
      `You can rep again <t:${nextRepTime.unix()}:R>`
    );
}