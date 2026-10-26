import type {
  ButtonBuilder as ButtonBuilderType,
  ComponentEmojiResolvable,
} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from "discord.js";

import { buildFeedbackPanelButton } from "@/features/feedback/presentation/views/FeedbackButton";
import Color from "@/utils/colors";

import type {
  AuditContext,
  AuditResult,
} from "../../application/PermissionAuditService";
import type { AuditTab, RatedFinding } from "../../domain/Finding";
import {
  SEVERITY_ORDER,
  permissionLabel,
} from "../../domain/permissionCatalog";
import { planChange } from "../../domain/planChange";
import { PERMISSION_AUDIT_CUSTOM_IDS, fixCustomId } from "../customIds";
import {
  discordDate,
  formatBot,
  formatFinding,
  formatFindingGroup,
  severityEmoji,
} from "./formatFinding";

export const PERMISSION_AUDIT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export type AuditViewTab = "overview" | AuditTab;

const FINDINGS_PER_PAGE = 5;
const TOP_FINDINGS = 3;
const LEARNING_ROLES_PER_BLOCK = 8;

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
  ];

export const TAB_BY_CUSTOM_ID: ReadonlyMap<string, AuditViewTab> = new Map(
  TABS.map(({ customId, tab }) => [customId, tab]),
);

const TAB_TITLES: Record<Exclude<AuditViewTab, "overview">, string> = {
  roles: "Roles",
  unused: "Unused permissions",
  channels: "Channel permission overrides",
};

export type PagedTab = Exclude<AuditViewTab, "overview">;

export interface PageBlock {
  text: string;
  /** Index into `report.findings` when the finding has an automatic fix. */
  fixIndex: number | null;
}

export type AuditPages = Record<PagedTab, PageBlock[][]>;

/** Formatting every finding is the expensive part, so a session does it once. */
export function buildAuditPages(
  result: AuditResult,
  everyoneRoleId: string,
): AuditPages {
  return {
    roles: tabPages(result, "roles", everyoneRoleId),
    unused: tabPages(result, "unused", everyoneRoleId),
    channels: tabPages(result, "channels", everyoneRoleId),
  };
}

export interface AuditMessageOptions {
  result: AuditResult;
  pages: AuditPages;
  everyoneRoleId: string;
  tab: AuditViewTab;
  /** Blocks for the current page of a paginated tab. */
  pageBlocks?: readonly PageBlock[];
  navButtons?: ActionRowBuilder<ButtonBuilderType> | null;
  disabled: boolean;
  /** Defaults to 💬 when unset. */
  feedbackEmoji?: ComponentEmojiResolvable;
}

/** Each page is a list of blocks; overview is never paginated. */
export function tabPages(
  result: AuditResult,
  tab: PagedTab,
  everyoneRoleId: string,
): PageBlock[][] {
  const { report } = result;
  const text = (value: string): PageBlock => ({ text: value, fixIndex: null });

  const blocks: PageBlock[] = [];
  report.findings.forEach((rated, index) => {
    if (rated.tab !== tab || learningUntil(rated)) {
      return;
    }
    const fixable = planChange(rated.finding, result.snapshot) !== null;
    blocks.push({
      text: formatFinding(rated, everyoneRoleId),
      fixIndex: fixable ? index : null,
    });
  });
  const pages = chunk(blocks, FINDINGS_PER_PAGE);

  if (tab === "unused") {
    pages.push(
      ...learningBlocks(report.findings, everyoneRoleId).map((b) => [b]),
    );
  }

  if (tab === "roles" && report.bots.length > 0) {
    pages.push(
      ...chunk(
        report.bots.map((b) => text(formatBot(b))),
        FINDINGS_PER_PAGE,
      ).map((page, i) => (i === 0 ? [text("### Bots"), ...page] : page)),
    );
  }

  if (tab === "unused" && report.notTracked.length > 0) {
    const notTracked = text(
      `-# **Not tracked:** sushii can't tell whether these are used, so they're never suggested for removal: ${report.notTracked
        .map(
          (entry) =>
            `<@&${entry.roleId}> (${entry.permissions.map(permissionLabel).join(", ")})`,
        )
        .join(" · ")}`,
    );
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
      `## Permission audit\n${headerLines(result.context)}`,
    ),
  );

  if (isCleanAudit(result)) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "✅ No risky or unused permissions found.",
      ),
    );
    // A clean result has no controls, so it never expires.
    addFooter(container, null, options.feedbackEmoji);
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
      addBlock(container, block, disabled);
    }
  }

  if (options.navButtons) {
    container.addActionRowComponents(options.navButtons);
  }

  addFooter(
    container,
    disabled
      ? "-# Expired after 5 minutes of inactivity. Run `/permission-audit` again."
      : "-# Expires after 5 minutes of inactivity.",
    options.feedbackEmoji,
  );

  return wrap(container);
}

export function isCleanAudit(result: AuditResult): boolean {
  return result.report.findings.length === 0 && result.report.bots.length === 0;
}

function addFooter(
  container: ContainerBuilder,
  expiry: string | null,
  feedbackEmoji: ComponentEmojiResolvable | undefined,
): void {
  const prompt = "-# Have feedback on the audit?";
  container.addSeparatorComponents(new SeparatorBuilder());
  // Feedback goes through the global router, so it stays enabled after expiry.
  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          expiry ? `${expiry}\n${prompt}` : prompt,
        ),
      )
      .setButtonAccessory(
        buildFeedbackPanelButton("permission-audit", feedbackEmoji),
      ),
  );
}

function headerLines(context: AuditContext): string {
  const lines = [
    context.canViewAuditLog
      ? context.historyStart
        ? `${context.guildName} · tracking since ${discordDate(context.historyStart)}`
        : context.guildName
      : `${context.guildName} · usage unavailable: sushii needs View Audit Log`,
  ];

  if (context.backfillPending) {
    lines.push("Importing older history, run again in a few minutes");
  }

  return lines.map((line) => `-# ${line}`).join("\n");
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
      def.tab === "unused" && !options.result.context.canViewAuditLog;

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
  const findings = result.report.findings.filter((f) => !learningUntil(f));
  const learning = result.report.findings
    .map(learningUntil)
    .filter((date) => date !== null);

  const counts = SEVERITY_ORDER.map((severity) => ({
    severity,
    count: findings.filter((f) => f.severity === severity).length,
  }))
    .filter(({ count }) => count > 0)
    .map(
      ({ severity, count }) =>
        `${severityEmoji(severity)} ${count} ${severity}`,
    )
    .join("  ·  ");

  if (counts) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(counts),
    );
  }

  const groups = groupByType(findings).slice(0, TOP_FINDINGS);
  if (groups.length > 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("### Needs attention"),
    );
    for (const group of groups) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          formatFindingGroup(group, everyoneRoleId),
        ),
      );
    }
  }

  if (learning.length > 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# ${learning.length === 1 ? "1 role has" : `${learning.length} roles have`} permissions not used yet. Check again after ${discordDate(latest(learning))}.`,
      ),
    );
  }
}

function addBlock(
  container: ContainerBuilder,
  block: PageBlock,
  disabled: boolean,
): void {
  if (block.fixIndex === null) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(block.text),
    );
    return;
  }

  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(block.text))
      .setButtonAccessory(
        new ButtonBuilder()
          .setCustomId(fixCustomId(block.fixIndex))
          .setLabel("Review fix…")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled),
      ),
  );
}

/** When an unused-permission finding becomes actionable, or null if it already is or isn't one. */
function learningUntil(rated: RatedFinding): Date | null {
  const f = rated.finding;
  return f.type === "unused_role_permission" && f.lowConfidence
    ? f.actionableAt
    : null;
}

/** Findings are sorted by severity, so each group's first entry is its worst. */
function groupByType(findings: readonly RatedFinding[]): RatedFinding[][] {
  const groups = new Map<string, RatedFinding[]>();
  for (const rated of findings) {
    const group = groups.get(rated.finding.type);
    if (group) {
      group.push(rated);
    } else {
      groups.set(rated.finding.type, [rated]);
    }
  }
  return [...groups.values()];
}

function latest(dates: readonly Date[]): Date {
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

/** Low-history unused findings share one note instead of each repeating it. */
function learningBlocks(
  findings: readonly RatedFinding[],
  everyoneRoleId: string,
): PageBlock[] {
  const learning = findings.flatMap((rated) => {
    const until = learningUntil(rated);
    return until && rated.finding.type === "unused_role_permission"
      ? [{ finding: rated.finding, until }]
      : [];
  });
  if (learning.length === 0) {
    return [];
  }

  const lines = learning.map(({ finding }) => {
    const role =
      finding.roleId === everyoneRoleId ? "@everyone" : `<@&${finding.roleId}>`;
    return `${role} · ${finding.permissions.map(permissionLabel).join(", ")}`;
  });
  const header = `### Not enough history yet\n-# Not used so far, but sushii hasn't watched long enough to suggest removing them. Check again after ${discordDate(latest(learning.map((l) => l.until)))}.`;

  return chunk(lines, LEARNING_ROLES_PER_BLOCK).map((group, i) => ({
    text: i === 0 ? `${header}\n${group.join("\n")}` : group.join("\n"),
    fixIndex: null,
  }));
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
