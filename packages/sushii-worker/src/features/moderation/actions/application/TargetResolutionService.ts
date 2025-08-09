import type {
  ChatInputCommandInteraction,
  GuildMember,
  User,
} from "discord.js";
import { Collection } from "discord.js";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import { ModerationTarget } from "../../shared/domain/entities/ModerationTarget";
import { OPTION_NAMES } from "../../shared/presentation/commands/ModerationCommandConstants";

export class TargetResolutionService {
  async fetchTargets(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<Result<ModerationTarget[], string>> {
    const targetsString = interaction.options.getString(OPTION_NAMES.USERS);
    if (!targetsString) {
      return Err("No target users provided");
    }

    const ID_REGEX = /\d{17,20}/g;
    const targetIds = targetsString.match(ID_REGEX);
    if (!targetIds) {
      return Err(
        "No users were provided, please specify which users to target with IDs or mentions.",
      );
    }

    if (targetIds.length > 25) {
      return Err("You can't target more than 25 users at once.");
    }

    const resolvedUsers =
      interaction.options.resolved?.users || new Collection<string, User>();
    const resolvedMembers =
      interaction.options.resolved?.members ||
      new Collection<string, GuildMember>();

    const targets: ModerationTarget[] = [];
    const memberFetchPromises: Promise<GuildMember>[] = [];
    const userFetchPromises: Promise<User>[] = [];

    for (const id of targetIds) {
      const resolvedUser = resolvedUsers.get(id);
      const resolvedMember = resolvedMembers.get(id);

      if (resolvedUser && resolvedMember) {
        targets.push(
          new ModerationTarget(resolvedUser, resolvedMember as GuildMember),
        );
      } else if (resolvedUser && !resolvedMember) {
        targets.push(new ModerationTarget(resolvedUser, null));
      } else {
        memberFetchPromises.push(interaction.guild.members.fetch(id));
      }
    }

    const memberResults = await Promise.allSettled(memberFetchPromises);
    for (let i = 0; i < memberResults.length; i++) {
      const result = memberResults[i];
      if (result.status === "fulfilled") {
        const member = result.value;
        targets.push(new ModerationTarget(member.user, member));
      } else {
        userFetchPromises.push(
          interaction.client.users.fetch(targetIds[targets.length + i]),
        );
      }
    }

    const userResults = await Promise.allSettled(userFetchPromises);
    for (const result of userResults) {
      if (result.status === "fulfilled") {
        const user = result.value;
        targets.push(new ModerationTarget(user, null));
      }
    }

    if (targets.length === 0) {
      return Err(
        "No valid target users were found. Please check IDs are correct and try again.",
      );
    }

    return Ok(targets);
  }
}
