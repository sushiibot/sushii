import type {
  GuildMember,
  InteractionReplyOptions,
  User,
} from "discord.js";
import {
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "discord.js";

import type { UserNameHistoryEntry } from "@/features/user-name-history";
import type { NamesResult } from "@/features/moderation/cases/application/NamesUserService";
import Color from "@/utils/colors";
import timestampToUnixTime from "@/utils/timestampToUnixTime";

export function buildUserNamesReply(
  targetUser: User,
  member: GuildMember | null,
  result: NamesResult,
  guildId: string,
): InteractionReplyOptions {
  const container = new ContainerBuilder().setAccentColor(Color.Info);

  container.addSectionComponents(buildUserHeaderSection(targetUser, member));
  container.addSeparatorComponents(new SeparatorBuilder());

  const usernameEntries = result.history.filter(
    (e) => e.nameType === "username",
  );
  const globalNameEntries = result.history.filter(
    (e) => e.nameType === "global_name",
  );
  const nicknameEntries = result.history.filter(
    (e) => e.nameType === "nickname" && e.guildId?.toString() === guildId,
  );

  if (usernameEntries.length > 0) {
    container.addTextDisplayComponents(
      buildHistorySection("Username History", usernameEntries, (e) =>
        formatEntryValue(e, (v) => `\`@${v}\``, targetUser.username),
      ),
    );
  }

  if (globalNameEntries.length > 0) {
    container.addTextDisplayComponents(
      buildHistorySection("Display Name History", globalNameEntries, (e) =>
        formatEntryValue(e, (v) => v, targetUser.globalName),
      ),
    );
  }

  if (nicknameEntries.length > 0) {
    container.addTextDisplayComponents(
      buildHistorySection(
        "Nickname History (this server)",
        nicknameEntries,
        (e) => formatEntryValue(e, (v) => v, member?.nickname),
      ),
    );
  }

  if (usernameEntries.length + globalNameEntries.length + nicknameEntries.length === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "*No name history recorded yet. History is captured from name change events going forward.*",
      ),
    );
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function buildUserHeaderSection(
  targetUser: User,
  member: GuildMember | null,
): SectionBuilder {
  const hasGlobalName =
    targetUser.globalName !== null &&
    targetUser.globalName !== targetUser.username;

  const title = hasGlobalName
    ? `### ${targetUser.globalName} (\`${targetUser.username}\`) — \`${targetUser.id}\``
    : `### ${targetUser.username} — \`${targetUser.id}\``;

  const createdTimestamp = timestampToUnixTime(targetUser.createdTimestamp);
  const parts: string[] = [
    `Created <t:${createdTimestamp}:f> (<t:${createdTimestamp}:R>)`,
  ];

  if (member?.joinedTimestamp) {
    const joinedTimestamp = timestampToUnixTime(member.joinedTimestamp);
    parts.push(`Joined <t:${joinedTimestamp}:f> (<t:${joinedTimestamp}:R>)`);
  }

  return new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${title}\n${parts.join("\n")}`),
    )
    .setThumbnailAccessory(
      new ThumbnailBuilder().setURL(targetUser.displayAvatarURL({ size: 512 })),
    );
}

function buildHistorySection(
  title: string,
  entries: UserNameHistoryEntry[],
  formatValue: (entry: UserNameHistoryEntry) => string,
): TextDisplayBuilder {
  const lines = entries.map((entry) => {
    const ts = timestampToUnixTime(entry.recordedAt.getTime());
    return `${formatValue(entry)} — <t:${ts}:R>`;
  });

  return new TextDisplayBuilder().setContent(
    `### ${title}\n${lines.join("\n")}`,
  );
}

function formatEntryValue(
  entry: UserNameHistoryEntry,
  formatDisplay: (value: string) => string,
  currentValue: string | null | undefined,
): string {
  const display = entry.value ? formatDisplay(entry.value) : "*(cleared)*";
  const isCurrent = entry.value === currentValue;
  return isCurrent ? `${display} (current)` : display;
}
