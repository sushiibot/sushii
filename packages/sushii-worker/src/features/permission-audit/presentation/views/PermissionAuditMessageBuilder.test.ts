import { describe, expect, test } from "bun:test";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ContainerBuilder,
} from "discord.js";

import type {
  AuditContext,
  AuditResult,
} from "../../application/PermissionAuditService";
import type { AuditReport, Finding, RatedFinding } from "../../domain/Finding";
import { PERMISSION_AUDIT_CUSTOM_IDS } from "../customIds";
import {
  type AuditViewTab,
  createAuditMessage,
  tabPages,
} from "./PermissionAuditMessageBuilder";
import { formatFinding } from "./formatFinding";

const EVERYONE = "1000";

const CONTEXT: AuditContext = {
  guildName: "Lisa Fan Server",
  canViewAuditLog: true,
  historyStart: new Date("2026-08-29T00:00:00Z"),
  backfillPending: false,
  cachedMembers: 100,
  totalMembers: 100,
};

const ALL_FINDINGS: Finding[] = [
  {
    type: "everyone_dangerous",
    roleId: EVERYONE,
    permissions: ["MentionEveryone"],
  },
  {
    type: "administrator_grant",
    roleId: "1",
    holderCount: 4,
    usedPermissions: ["KickMembers"],
    isBotRole: false,
  },
  {
    type: "administrator_grant",
    roleId: "2",
    holderCount: 1,
    usedPermissions: [],
    isBotRole: true,
  },
  {
    type: "unused_role_permission",
    roleId: "3",
    permissions: ["ManageWebhooks"],
    holderCount: 9,
    lowConfidence: false,
    actionableAt: null,
  },
  {
    type: "unused_role_permission",
    roleId: "4",
    permissions: ["KickMembers"],
    holderCount: 2,
    lowConfidence: true,
    actionableAt: new Date("2026-10-27T00:00:00Z"),
  },
  {
    type: "possibly_used_through_bots",
    roleId: "5",
    permissions: ["BanMembers"],
  },
  {
    type: "partially_used_role",
    roleId: "6",
    permission: "BanMembers",
    holderCount: 12,
    activeCount: 9,
    usedByIds: ["11", "12"],
  },
  {
    type: "inactive_holders",
    roleId: "7",
    holderCount: 12,
    inactiveIds: ["21", "22", "23", "24", "25", "26", "27"],
  },
  {
    type: "self_assignable_role",
    roleId: "8",
    permissions: ["ManageMessages"],
    source: "role menu Pick roles",
    restricted: false,
  },
  {
    type: "escalation",
    roleId: "9",
    reachableRoleId: "10",
    gainedPermissions: ["ManageGuild"],
  },
  { type: "mfa_disabled", roleIds: ["3", "6"] },
  {
    type: "dangerous_overwrite",
    channelId: "c1",
    channelName: "general",
    targetId: "3",
    targetType: "role",
    permissions: ["ManageWebhooks"],
  },
  {
    type: "dead_overwrite",
    channelId: "c2",
    channelName: "mod-chat",
    targetId: "1",
  },
];

const TAB_BY_TYPE: Record<Finding["type"], RatedFinding["tab"]> = {
  everyone_dangerous: "roles",
  administrator_grant: "roles",
  partially_used_role: "roles",
  inactive_holders: "roles",
  self_assignable_role: "roles",
  escalation: "roles",
  mfa_disabled: "roles",
  unused_role_permission: "unused",
  possibly_used_through_bots: "unused",
  dangerous_overwrite: "channels",
  dead_overwrite: "channels",
};

function report(overrides: Partial<AuditReport> = {}): AuditReport {
  return {
    findings: ALL_FINDINGS.map((finding) => ({
      finding,
      severity: "critical",
      tab: TAB_BY_TYPE[finding.type],
    })),
    bots: [
      {
        roleId: "2",
        botUserId: "77",
        permissions: ["Administrator"],
        addedRecently: true,
      },
    ],
    members: Array.from({ length: 9 }, (_, i) => ({
      memberId: String(100 + i),
      username: `member${i}`,
      viaRoleIds: ["1"],
      permissions: [
        {
          permission: "BanMembers" as const,
          lastUsedAt: null,
          mayBeUsedThroughBots: false,
        },
        {
          permission: "KickMembers" as const,
          lastUsedAt: new Date(),
          mayBeUsedThroughBots: false,
        },
        {
          permission: "ManageMessages" as const,
          lastUsedAt: null,
          mayBeUsedThroughBots: true,
        },
      ],
    })),
    notTracked: [{ roleId: "3", permissions: ["ViewAuditLog"] }],
    holderCounts: { Administrator: 4, ManageRoles: 6, BanMembers: 34 },
    ...overrides,
  };
}

function result(
  reportOverrides: Partial<AuditReport> = {},
  context: Partial<AuditContext> = {},
): AuditResult {
  return {
    report: report(reportOverrides),
    context: { ...CONTEXT, ...context },
  };
}

function countComponents(json: unknown): number {
  if (typeof json !== "object" || json === null) {
    return 0;
  }
  const node = json as { components?: unknown[]; accessory?: unknown };
  const children = node.components ?? [];
  return (
    1 +
    children.reduce<number>((sum, child) => sum + countComponents(child), 0) +
    (node.accessory ? countComponents(node.accessory) : 0)
  );
}

function textLength(json: unknown): number {
  if (typeof json !== "object" || json === null) {
    return 0;
  }
  const node = json as { content?: string; components?: unknown[] };
  return (
    (node.content?.length ?? 0) +
    (node.components ?? []).reduce<number>((sum, c) => sum + textLength(c), 0)
  );
}

function textOf(container: ContainerBuilder): string {
  return JSON.stringify(container.toJSON());
}

function render(tab: AuditViewTab, res = result(), page = 0) {
  const pageBlocks =
    tab === "overview" ? undefined : tabPages(res, tab, EVERYONE)[page];
  const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...["a", "b", "c", "d", "e"].map((id) =>
      new ButtonBuilder()
        .setCustomId(id)
        .setLabel(id)
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return createAuditMessage({
    result: res,
    everyoneRoleId: EVERYONE,
    tab,
    pageBlocks,
    navButtons: tab === "overview" ? null : nav,
    disabled: false,
  }).components[0];
}

function tabButton(container: ContainerBuilder, customId: string) {
  const json = container.toJSON() as {
    components: {
      type: number;
      components?: { custom_id?: string; disabled?: boolean; style?: number }[];
    }[];
  };
  return json.components
    .flatMap((c) => c.components ?? [])
    .find((c) => c.custom_id === customId);
}

describe("formatFinding", () => {
  test.each(ALL_FINDINGS.map((f) => [f.type, f] as const))(
    "%s renders without placeholders",
    (_, finding) => {
      const text = formatFinding(
        { finding, severity: "high", tab: TAB_BY_TYPE[finding.type] },
        EVERYONE,
      );

      expect(text).toStartWith("🟠 High · ");
      expect(text).toContain("\n-# ");
      expect(text).not.toMatch(/undefined|null|NaN|\[object/);
    },
  );

  test("@everyone renders as text, not a role mention", () => {
    const text = formatFinding(
      { finding: ALL_FINDINGS[0] as Finding, severity: "high", tab: "roles" },
      EVERYONE,
    );

    expect(text).toContain("@everyone has");
    expect(text).not.toContain(`<@&${EVERYONE}>`);
  });
});

describe("createAuditMessage", () => {
  test.each<AuditViewTab>([
    "overview",
    "roles",
    "unused",
    "channels",
    "members",
  ])("%s stays inside Discord's limits", (tab) => {
    const container = render(tab);

    expect(countComponents(container.toJSON())).toBeLessThanOrEqual(40);
    expect(textLength(container.toJSON())).toBeLessThanOrEqual(4000);
  });

  test("header shows the server and history start above the tabs", () => {
    const json = render("overview").toJSON() as {
      components: { type: number; content?: string }[];
    };

    expect(json.components[0]?.content).toContain("## Permission audit");
    expect(json.components[0]?.content).toContain("Lisa Fan Server");
    expect(json.components[0]?.content).toContain("usage observed since <t:");
    expect(json.components[1]?.type).toBe(1);
  });

  test("header notes pending import and partial member cache", () => {
    const json = render(
      "overview",
      result(
        {},
        { backfillPending: true, cachedMembers: 4812, totalMembers: 52300 },
      ),
    ).toJSON() as { components: { content?: string }[] };

    expect(json.components[0]?.content).toContain("importing older history");
    expect(json.components[0]?.content).toContain(
      "based on 4,812 of 52,300 members",
    );
  });

  test("active tab is primary and disabled", () => {
    const button = tabButton(
      render("roles"),
      PERMISSION_AUDIT_CUSTOM_IDS.tabRoles,
    );

    expect(button?.style).toBe(ButtonStyle.Primary);
    expect(button?.disabled).toBe(true);
  });

  test("tabs with nothing to show are disabled", () => {
    const res = result({
      findings: report().findings.filter((f) => f.tab !== "channels"),
    });

    expect(
      tabButton(
        render("overview", res),
        PERMISSION_AUDIT_CUSTOM_IDS.tabChannels,
      )?.disabled,
    ).toBe(true);
  });

  test("without audit log access, Unused and Members are disabled", () => {
    const container = render(
      "overview",
      result({}, { canViewAuditLog: false, historyStart: null }),
    );

    expect(
      tabButton(container, PERMISSION_AUDIT_CUSTOM_IDS.tabUnused)?.disabled,
    ).toBe(true);
    expect(
      tabButton(container, PERMISSION_AUDIT_CUSTOM_IDS.tabMembers)?.disabled,
    ).toBe(true);
    expect(textOf(container)).toContain("sushii needs View Audit Log");
  });

  test("clean server has no tabs", () => {
    const container = render("overview", result({ findings: [], bots: [] }));
    const json = container.toJSON() as { components: { type: number }[] };

    expect(json.components.some((c) => c.type === 1)).toBe(false);
    expect(textOf(container)).toContain("No risky or unused permissions found");
  });

  test("expired view says so and disables every tab", () => {
    const container = createAuditMessage({
      result: result(),
      everyoneRoleId: EVERYONE,
      tab: "overview",
      disabled: true,
    }).components[0];

    expect(textOf(container)).toContain("Expired after 5 minutes");
    expect(
      tabButton(container, PERMISSION_AUDIT_CUSTOM_IDS.tabOverview)?.style,
    ).toBe(ButtonStyle.Secondary);
    expect(
      tabButton(container, PERMISSION_AUDIT_CUSTOM_IDS.tabRoles)?.disabled,
    ).toBe(true);
  });
});

describe("tabPages", () => {
  test("roles tab ends with the bots group", () => {
    const pages = tabPages(result(), "roles", EVERYONE);

    expect(pages.at(-1)?.[0]).toBe("### Bots");
  });

  test("unused tab ends with the not-tracked note", () => {
    const pages = tabPages(result(), "unused", EVERYONE);

    expect(pages.at(-1)?.at(-1)).toContain("Not tracked");
  });

  test("findings are paged by five", () => {
    const pages = tabPages(result(), "roles", EVERYONE);

    expect(pages[0]).toHaveLength(5);
  });

  test("members are paged by six", () => {
    const pages = tabPages(result(), "members", EVERYONE);

    expect(pages.map((p) => p.length)).toEqual([6, 3]);
  });
});
