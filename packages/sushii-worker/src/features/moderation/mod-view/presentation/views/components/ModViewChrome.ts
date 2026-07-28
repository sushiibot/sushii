import type {
  ButtonBuilder as ButtonBuilderType,
  ContainerBuilder,
  GuildMember,
  User,
} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "discord.js";

import type { ModViewStanding } from "@/features/moderation/mod-view/application/ModViewService";
import { countWithNoun, pluralizeNoun } from "@/shared/presentation/pluralize";
import timestampToUnixTime from "@/utils/timestampToUnixTime";

import { MODVIEW_CUSTOM_IDS } from "../../customIds";

const FIELD_SEPARATOR = " · ";

export type ModViewTab = "overview" | "history" | "alts" | "names" | "lookup";

const TAB_DEFS: readonly {
  tab: ModViewTab;
  label: string;
  customId: string;
}[] = [
  {
    tab: "overview",
    label: "Overview",
    customId: MODVIEW_CUSTOM_IDS.tabOverview,
  },
  { tab: "history", label: "History", customId: MODVIEW_CUSTOM_IDS.tabHistory },
  { tab: "alts", label: "Alts", customId: MODVIEW_CUSTOM_IDS.tabAlts },
  { tab: "names", label: "Names", customId: MODVIEW_CUSTOM_IDS.tabNames },
  { tab: "lookup", label: "Lookup", customId: MODVIEW_CUSTOM_IDS.tabLookup },
];

/**
 * `###` is reserved for this header and MUST NOT appear anywhere else in the
 * message — see the content-grammar spec's heading-hierarchy requirement.
 */
export function addIdentityHeader(
  container: ContainerBuilder,
  user: User,
  member: GuildMember | null,
  standing: ModViewStanding | null,
): void {
  const hasGlobalName =
    user.globalName !== null && user.globalName !== user.username;
  const displayName = hasGlobalName ? user.globalName : user.username;

  const lines: string[] = [`### ${displayName}`];
  lines.push(`@${user.username}${FIELD_SEPARATOR}\`${user.id}\``);

  if (member?.nickname) {
    lines.push(`Nickname: ${member.nickname}`);
  }

  const roleLine = formatHighestRoleLine(member);
  if (roleLine) {
    lines.push(roleLine);
  }

  const createdTimestamp = timestampToUnixTime(user.createdTimestamp);
  const dateParts = [`Created <t:${createdTimestamp}:R>`];
  if (member?.joinedTimestamp) {
    dateParts.push(
      `Joined <t:${timestampToUnixTime(member.joinedTimestamp)}:R>`,
    );
  }
  lines.push(dateParts.join(FIELD_SEPARATOR));

  // Presence alone is the signal — omitted entirely rather than stating "none".
  if (standing) {
    lines.push(formatStandingLine(standing));
  }

  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(lines.join("\n")),
    )
    .setThumbnailAccessory(
      new ThumbnailBuilder().setURL(user.displayAvatarURL({ size: 512 })),
    );

  container.addSectionComponents(section);
}

/** Ported from `UserLookupView.buildUserHeaderSection` — same highest-role selection logic. */
function formatHighestRoleLine(member: GuildMember | null): string | null {
  if (!member || member.roles.cache.size <= 1) {
    return null;
  }

  const nonEveryoneRoles = member.roles.cache
    .filter((role) => role.name !== "@everyone")
    .sort((a, b) => b.position - a.position);

  const highestPermRole = nonEveryoneRoles.find(
    (role) => role.permissions.bitfield !== 0n,
  );
  if (!highestPermRole) {
    return null;
  }

  const count = nonEveryoneRoles.size;
  return `${highestPermRole}${FIELD_SEPARATOR}${countWithNoun(count, "role")}`;
}

function formatStandingLine(standing: ModViewStanding): string {
  const endsUnix = timestampToUnixTime(standing.endsAt.getTime());

  if (standing.kind === "timeout") {
    return `**Timed out**${FIELD_SEPARATOR}ends <t:${endsUnix}:R>`;
  }

  return `**Banned**${FIELD_SEPARATOR}lifts <t:${endsUnix}:R>`;
}

/**
 * One action row of all 5 tabs, always. `disabled` is the whole-view expiry
 * flag: live, exactly the active tab is `Primary`+disabled; expired, all
 * five are `Secondary`+disabled — the two states must stay visually distinct.
 */
export function addTabRow(
  container: ContainerBuilder,
  activeTab: ModViewTab,
  disabled: boolean,
): void {
  const row = new ActionRowBuilder<ButtonBuilderType>();

  for (const def of TAB_DEFS) {
    const isActive = def.tab === activeTab;

    const button = new ButtonBuilder()
      .setCustomId(def.customId)
      .setLabel(def.label)
      .setStyle(
        isActive && !disabled ? ButtonStyle.Primary : ButtonStyle.Secondary,
      )
      .setDisabled(disabled || isActive);

    row.addComponents(button);
  }

  container.addActionRowComponents(row);
}

/**
 * Wraps the header + tab row so no tab builder can omit them or emit them
 * out of order. Must be called on the container the paginator's
 * `renderContainer` returns — chrome built outside that container is wiped
 * on every page turn (see design D3).
 */
export function addChrome(
  container: ContainerBuilder,
  user: User,
  member: GuildMember | null,
  standing: ModViewStanding | null,
  activeTab: ModViewTab,
  disabled: boolean,
): void {
  addIdentityHeader(container, user, member, standing);
  addTabRow(container, activeTab, disabled);
}

/**
 * One Overview row: label + value, and a `View ›` accessory that opens the
 * tab. `disabled` on `· 0` (nothing more to show), enabled on `· not
 * available` (the explanation lives on the tab) — the caller decides which.
 */
export function addSummaryRow(
  container: ContainerBuilder,
  label: string,
  valueText: string,
  customId: string,
  disabled: boolean,
): void {
  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${label}**${FIELD_SEPARATOR}${valueText}`,
      ),
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId(customId)
        .setLabel("View ›")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
    );

  container.addSectionComponents(section);
}

/**
 * The leading `-#` subtext line(s) of an entry-list screen — total, scope
 * qualifier, ordering. Accepts pre-joined multi-line text; each line gets
 * its own `-#` prefix.
 */
export function addScopeBlock(container: ContainerBuilder, text: string): void {
  const content = text
    .split("\n")
    .map((line) => `-# ${line}`)
    .join("\n");

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(content),
  );
}

/**
 * The empty/unavailable shape: a bold sentence fragment, then a `-#`
 * subtext sentence. Never subtext-only — that reads as a rendering failure.
 */
export function addStateLine(
  container: ContainerBuilder,
  boldFragment: string,
  subtext: string,
): void {
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`**${boldFragment}**\n-# ${subtext}`),
  );
}

/**
 * `-# +{N} more {noun}` — matches `packItems`'s overflow line format exactly.
 * `noun` is singular; pluralized here to agree with `count`.
 */
export function addOverflowLine(
  container: ContainerBuilder,
  count: number,
  noun: string,
): void {
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `-# +${count} more ${pluralizeNoun(noun, count)}`,
    ),
  );
}
