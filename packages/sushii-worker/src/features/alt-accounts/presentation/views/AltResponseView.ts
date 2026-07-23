import { ContainerBuilder, TextDisplayBuilder } from "discord.js";

import Color from "@/utils/colors";

import type { LinkOutcome, RemoveMemberOutcome } from "../../domain/repositories/AltAccountRepository";
import type { SetNicknameOutcome } from "../../application/SetNicknameService";

function simpleContainer(content: string, color: Color): ContainerBuilder {
  return new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

export function buildLinkOutcomeContainer(
  outcome: LinkOutcome,
  userIdA: string,
  userIdB: string,
  reason: string | null,
): ContainerBuilder {
  switch (outcome.kind) {
    case "created":
      return simpleContainer(
        `Linked <@${userIdA}> and <@${userIdB}> as a new identity.` +
          (reason ? `\n**Reason:** ${reason}` : ""),
        Color.Success,
      );
    case "added": {
      const existingUserId =
        outcome.addedUserId === userIdA ? userIdB : userIdA;

      return simpleContainer(
        `Added <@${outcome.addedUserId}> to <@${existingUserId}>'s existing identity.` +
          (reason ? `\n**Reason:** ${reason}` : ""),
        Color.Success,
      );
    }
    case "alreadyLinked":
      return simpleContainer(
        `<@${userIdA}> and <@${userIdB}> are already linked to the same identity.`,
        Color.Info,
      );
    case "merged": {
      let content = `Merged the identities for <@${userIdA}> and <@${userIdB}> into one.`;

      if (outcome.keptNickname && outcome.discardedNickname) {
        content += `\nKept nickname **${outcome.keptNickname}**, merged in **${outcome.discardedNickname}** (use \`/alts nickname\` to rename).`;
      }

      if (reason) {
        content += `\n**Reason:** ${reason} (not saved — merges don't persist a reason)`;
      }

      return simpleContainer(content, Color.Success);
    }
  }
}

export function buildUnlinkOutcomeContainer(
  outcome: RemoveMemberOutcome,
  userId: string,
  reason: string | null,
): ContainerBuilder {
  if (outcome.kind === "notLinked") {
    return simpleContainer(
      `<@${userId}> isn't linked to any identity in this server.`,
      Color.Info,
    );
  }

  let content = `Unlinked <@${userId}> from its identity.`;
  if (outcome.identityDeleted) {
    content += " That identity had no other members, so it was removed.";
  }
  if (reason) {
    content += `\n**Reason:** ${reason} (not saved)`;
  }

  return simpleContainer(content, Color.Success);
}

export function formatNicknameChangeMessage(nickname: string | null): string {
  return nickname
    ? `Set the identity's nickname to **${nickname}**.`
    : "Cleared the identity's nickname.";
}

export function buildNicknameOutcomeContainer(
  outcome: SetNicknameOutcome,
  userId: string,
  nickname: string | null,
): ContainerBuilder {
  if (outcome.kind === "noIdentity") {
    return simpleContainer(
      `<@${userId}> has no linked identity to name.`,
      Color.Warning,
    );
  }

  return simpleContainer(formatNicknameChangeMessage(nickname), Color.Success);
}
