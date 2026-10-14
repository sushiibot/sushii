import type { ButtonBuilder as ButtonBuilderType } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from "discord.js";

import Color from "@/utils/colors";

import type {
  AuditContext,
  AuditResult,
} from "../../application/PermissionAuditService";
import type { AuditTab } from "../../domain/Finding";
import type { PermissionName } from "../../domain/PermissionUsage";
import {
  SEVERITY_ORDER,
  permissionLabel,
} from "../../domain/permissionCatalog";
import { PERMISSION_AUDIT_CUSTOM_IDS } from "../customIds";
import {
  discordDate,
  formatBot,
  formatFinding,
  formatMember,
  severityLabel,
} from "./formatFinding";

export const PERMISSION_AUDIT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export type AuditViewTab = "overview" | AuditTab | "members";

const FINDINGS_PER_PAGE = 5;
const MEMBERS_PER_PAGE = 6;
const TOP_FINDINGS = 3;

const TABS: readonly { tab: AuditViewTab; label: string; customId: string }[] =
  [
    {
      tab: "overview",
      label: "Overview",
      customId: PERMISSION_AUDIT_CUSTOM_IDS.tabOverview,
    },
    {
      tab: "roles",
      label: "Roles",
      customId: PERMISSION_AUDIT_CUSTOM_IDS.tabRoles,
    },
    {
      tab: "unused",
      label: "Unused",
      customId: PERMISSION_AUDIT_CUSTOM_IDS.tabUnused,
    },
    {
      tab: "channels",
      label: "Channels",
      customId: PERMISSION_AUDIT_CUSTOM_IDS.tabChannels,
    },
    {
      tab: "members",
      label: "Members",
      customId: PERMISSION_AUDIT_CUSTOM_IDS.tabMembers,
    },
  ];

export const TAB_BY_CUSTOM_ID: ReadonlyMap<string, AuditViewTab> = new Map(
  TABS.map(({ customId, tab }) => [customId, tab]),
);

const TAB_TITLES: Record<Exclude<AuditViewTab, "overview">, string> = {
  roles: "Roles",
  unused: "Unused permissions",
  channels: "Channel permission overrides",
  members: "Members with dangerous permissions",
};

export type PagedTab = Exclude<AuditViewTab, "overview">;
export type AuditPages = Record<PagedTab, string[][]>;

/** Formatting every finding is the expensive part, so a session does it once. */
export function buildAuditPages(
  result: AuditResult,
  everyoneRoleId: string,
): AuditPages {
  return {
    roles: tabPages(result, "roles", everyoneRoleId),
    unused: tabPages(result, "unused", everyoneRoleId),
    channels: tabPages(result, "channels", everyoneRoleId),
    members: tabPages(result, "members", everyoneRoleId),
  };
}

export interface AuditMessageOptions {
  result: AuditResult;
  pages: AuditPages;
  everyoneRoleId: string;
  tab: AuditViewTab;
  /** Blocks for the current page of a paginated tab. */
  pageBlocks?: readonly string[];
  navButtons?: ActionRowBuilder<ButtonBuilderType> | null;
  disabled: boolean;
}

/** Each page is a list of markdown blocks; overview is never paginated. */
export function tabPages(
  result: AuditResult,
  tab: PagedTab,
  everyoneRoleId: string,
): string[][] {
  const { report } = result;

  if (tab === "members") {
    return chunk(report.members.map(formatMember), MEMBERS_PER_PAGE);
  }

  const blocks = report.findings
    .filter((rated) => rated.tab === tab)
    .map((rated) => formatFinding(rated, everyoneRoleId));
  const pages = chunk(blocks, FINDINGS_PER_PAGE);

  if (tab === "roles" && report.bots.length > 0) {
    pages.push(
      ...chunk(report.bots.map(formatBot), FINDINGS_PER_PAGE).map((page, i) =>
        i === 0 ? ["### Bots", ...page] : page,
      ),
    );
  }

  if (tab === "unused" && report.notTracked.length > 0) {
    const notTracked = `-# **Not tracked:** sushii can't tell whether these are used, so they're never suggested for removal: ${report.notTracked
      .map(
        (entry) =>
          `<@&${entry.roleId}> (${entry.permissions.map(permissionLabel).join(", ")})`,
      )
      .join(" · ")}`;
    const last = pages.at(-1);
    if (last) {
      last.push(notTracked);
    } else {
      pages.push([notTracked]);
    }
  }

  return pages;
}

export function createAuditMessage(options: AuditMessageOptions): {
  components: ContainerBuilder[];
  flags: MessageFlags.IsComponentsV2;
  allowedMentions: { parse: [] };
} {
  const { result, tab, disabled } = options;
  const container = new ContainerBuilder().setAccentColor(Color.Info);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Permission audit\n-# ${headerLine(result.context)}`,
    ),
  );

  const isClean =
    result.report.findings.length === 0 && result.report.bots.length === 0;

  if (isClean) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "✅ No risky or unused permissions found.",
      ),
    );
    return wrap(container);
  }

  container.addActionRowComponents(tabRow(options));
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  if (tab === "overview") {
    addOverview(container, result, options.everyoneRoleId);
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${TAB_TITLES[tab]}`),
    );
    for (const block of options.pageBlocks ?? []) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(block),
      );
    }
  }

  if (options.navButtons) {
    container.addActionRowComponents(options.navButtons);
  }

  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      disabled
        ? "-# Expired after 5 minutes of inactivity. Run `/permission-audit` again."
        : "-# Expires after 5 minutes of inactivity.",
    ),
  );

  return wrap(container);
}

function headerLine(context: AuditContext): string {
  const parts = [context.guildName];

  if (!context.canViewAuditLog) {
    parts.push("usage history unavailable: sushii needs View Audit Log");
  } else if (context.historyStart) {
    parts.push(`usage observed since ${discordDate(context.historyStart)}`);
  }

  if (context.backfillPending) {
    parts.push("importing older history, run again in a few minutes");
  }

  if (context.cachedMembers < context.totalMembers) {
    parts.push(
      `based on ${context.cachedMembers.toLocaleString()} of ${context.totalMembers.toLocaleString()} members`,
    );
  }

  return parts.join(" · ");
}

function tabRow(
  options: AuditMessageOptions,
): ActionRowBuilder<ButtonBuilderType> {
  const row = new ActionRowBuilder<ButtonBuilderType>();

  for (const def of TABS) {
    const isActive = def.tab === options.tab;
    const hasContent =
      def.tab === "overview" || options.pages[def.tab].length > 0;
    const needsAuditLog =
      (def.tab === "unused" || def.tab === "members") &&
      !options.result.context.canViewAuditLog;

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(def.customId)
        .setLabel(def.label)
        .setStyle(
          isActive && !options.disabled
            ? ButtonStyle.Primary
            : ButtonStyle.Secondary,
        )
        .setDisabled(
          options.disabled || isActive || !hasContent || needsAuditLog,
        ),
    );
  }

  return row;
}

function addOverview(
  container: ContainerBuilder,
  result: AuditResult,
  everyoneRoleId: string,
): void {
  const { findings, holderCounts } = result.report;

  const counts = SEVERITY_ORDER.map((severity) => ({
    severity,
    count: findings.filter((f) => f.severity === severity).length,
  }))
    .filter(({ count }) => count > 0)
    .map(({ severity, count }) => `${severityLabel(severity)} **${count}**`)
    .join(" · ");

  if (counts) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(counts),
    );
  }

  const top = findings.slice(0, TOP_FINDINGS);
  if (top.length > 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          "### Top findings",
          ...top.map((f) => formatFinding(f, everyoneRoleId)),
        ].join("\n"),
      ),
    );
  }

  const concentration = Object.entries(holderCounts)
    .map(
      ([permission, count]) =>
        `${permissionLabel(permission as PermissionName)} **${count}**`,
    )
    .join(" · ");
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `### Members who can use\n${concentration}`,
    ),
  );
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages;
}

function wrap(container: ContainerBuilder) {
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 as const,
    allowedMentions: { parse: [] as [] },
  };
}
