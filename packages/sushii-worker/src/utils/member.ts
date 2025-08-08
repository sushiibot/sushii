import type {
  APIGuildMember,
  APIInteractionDataResolvedGuildMember,
} from "discord.js";

import dayjs from "@/shared/domain/dayjs";

export default function memberIsTimedOut(
  member: APIGuildMember | APIInteractionDataResolvedGuildMember | undefined,
): boolean {
  if (!member?.communication_disabled_until) {
    return false;
  }

  // End time not reached yet
  // now < endTime
  return dayjs().utc().isBefore(member.communication_disabled_until);
}
