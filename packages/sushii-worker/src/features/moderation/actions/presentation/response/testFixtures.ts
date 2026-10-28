import type { GuildMember, User } from "discord.js";

import type { DMResult } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { ModerationTarget } from "@/features/moderation/shared/domain/entities/ModerationTarget";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { Reason } from "@/features/moderation/shared/domain/value-objects/Reason";

import {
  MODERATION_ACTION_EMOJIS,
  type ModerationActionEmojis,
} from "../views/ModerationActionView";
import { ACTION_RESPONSE_EMOJIS } from "./ActionResponseButtonHandler";

export const GUILD = "187450744427773963";
export const MOD = "150443906511667200";
export const OTHER_MOD = "150443906511667201";
export const TARGET = "912345678901234567";
export const TARGET_2 = "912345678901234568";
export const TARGET_3 = "912345678901234569";
export const DM = {
  channelId: "1029384756102938400",
  messageId: "1029384756102938401",
};

export function botEmoji(name: string): string {
  return `<:${name}:1234567890123456789>`;
}

export function makeEmojis(): ModerationActionEmojis {
  return Object.fromEntries(
    MODERATION_ACTION_EMOJIS.map((name) => [name, botEmoji(name)]),
  ) as ModerationActionEmojis;
}

export function makeAllEmojis(): Record<
  (typeof ACTION_RESPONSE_EMOJIS)[number],
  string
> {
  return Object.fromEntries(
    ACTION_RESPONSE_EMOJIS.map((name) => [name, botEmoji(name)]),
  ) as Record<(typeof ACTION_RESPONSE_EMOJIS)[number], string>;
}

export function makeUser(id: string, username: string): User {
  return {
    id,
    username,
    tag: username,
    displayName: username,
    displayAvatarURL: () => `https://cdn.discordapp.com/embed/avatars/1.png`,
  } as unknown as User;
}

export function makeTarget(id: string, username: string, inGuild = true) {
  const user = makeUser(id, username);
  return new ModerationTarget(
    user,
    inGuild ? ({ displayName: username } as GuildMember) : null,
  );
}

export interface CaseOptions {
  caseId?: string;
  actionType?: ActionType;
  userId?: string;
  userTag?: string;
  reason?: string | null;
  dm?: DMResult | null;
  dmDeleted?: boolean;
  dmIntentSource?: "executor_no" | "guild_default" | "warn_always";
  reasonSetBy?: string | null;
  reasonSetAt?: Date | null;
  timeoutDuration?: number | null;
}

export function makeCase(options: CaseOptions = {}): ModerationCase {
  const dm: DMResult | null = options.dm === undefined ? DM : options.dm;
  return new ModerationCase(
    GUILD,
    options.caseId ?? "4822",
    options.actionType ?? ActionType.Ban,
    new Date("2026-10-27T11:00:00.000Z"),
    options.userId ?? TARGET,
    options.userTag ?? "spambot",
    MOD,
    options.reason === null
      ? null
      : Reason.create(options.reason ?? "Spamming invite links").unwrap(),
    "1029384756102938499",
    [],
    dm,
    false,
    options.timeoutDuration ?? null,
    !!dm,
    options.dmIntentSource ?? "guild_default",
    !!dm,
    null,
    dm?.error ? (dm.failureReason ?? "unknown") : null,
    null,
    options.dmDeleted ?? false,
    options.reasonSetBy ?? null,
    options.reasonSetAt ?? null,
    options.dmDeleted ? OTHER_MOD : null,
    options.dmDeleted ? new Date("2026-10-27T11:05:00.000Z") : null,
  );
}

/** Any emoji drawn by the platform instead of a bot emoji. */
export const NATIVE_EMOJI = /\p{Extended_Pictographic}/u;
