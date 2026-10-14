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
import type { GuildSnapshot, RoleSnapshot } from "../../domain/GuildSnapshot";
import { PERMISSION_AUDIT_CUSTOM_IDS } from "../customIds";
import {
  type AuditViewTab,
  buildAuditPages,
  createAuditMessage,
  tabPages,
} from "./PermissionAuditMessageBuilder";
import { formatFinding, formatFindingGroup } from "./formatFinding";

const EVERYONE = "1000";

const CONTEXT: AuditContext = {
  guildName: "Lisa Fan Server",
  canViewAuditLog: true,
  historyStart: new Date("2026-08-29T00:00:00Z"),
  backfillPending: false,
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
    lowConfidence: false,
    actionableAt: null,
  },
  {
    type: "administrator_grant",
    roleId: "2",
    holderCount: 1,
    usedPermissions: [],
    isBotRole: true,
    lowConfidence: false,
    actionableAt: null,
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
    notTracked: [{ roleId: "3", permissions: ["ViewAuditLog"] }],
    ...overrides,
  };
}

function snapshotRole(id: string): RoleSnapshot {
  return {
    id,
    name: `role-${id}`,
    position: 1,
    permissions: 0n,
    botUserId: null,
    createdAt: new Date(0),
    holderCount: 0,
    holderIds: [],
  };
}

const SNAPSHOT: GuildSnapshot = {
  guildId: EVERYONE,
  ownerId: "9",
  everyoneRoleId: EVERYONE,
  mfaRequired: true,
  roles: [EVERYONE, "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map(
    snapshotRole,
  ),
  overwrites: [
    {
      channelId: "c1",
      channelName: "general",
      targetId: "3",
      targetType: "role",
      allow: 1n,
      deny: 0n,
    },
    {
      channelId: "c2",
      channelName: "mod-chat",
      targetId: "1",
      targetType: "role",
      allow: 1n,
      deny: 0n,
    },
  ],
  memberCount: 100,
  members: new Map(),
  selfAssignable: [],
  now: new Date(),
};

function result(
  reportOverrides: Partial<AuditReport> = {},
  context: Partial<AuditContext> = {},
): AuditResult {
  return {
    report: report(reportOverrides),
    context: { ...CONTEXT, ...context },
    snapshot: SNAPSHOT,
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
    pages: buildAuditPages(res, EVERYONE),
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

      expect(text).toStartWith("🟠 ");
      expect(text).toContain("\n-# ");
      expect(text).not.toMatch(/undefined|null|NaN|\[object/);
    },
  );

  test.each(ALL_FINDINGS.map((f) => [f.type, f] as const))(
    "%s group renders without placeholders",
    (_, finding) => {
      const text = formatFindingGroup(
        [{ finding, severity: "high", tab: TAB_BY_TYPE[finding.type] }],
        EVERYONE,
      );

      expect(text).toStartWith("🟠 **");
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
  test.each<AuditViewTab>(["overview", "roles", "unused", "channels"])(
    "%s stays inside Discord's limits",
    (tab) => {
      const container = render(tab);

      expect(countComponents(container.toJSON())).toBeLessThanOrEqual(40);
      expect(textLength(container.toJSON())).toBeLessThanOrEqual(4000);
    },
  );

  test("header shows the server and history start above the tabs", () => {
    const json = render("overview").toJSON() as {
      components: { type: number; content?: string }[];
    };

    expect(json.components[0]?.content).toContain("## Permission audit");
    expect(json.components[0]?.content).toContain("Lisa Fan Server");
    expect(json.components[0]?.content).toContain("tracking since <t:");
    expect(json.components[1]?.type).toBe(1);
  });

  test("header notes a pending import on its own line", () => {
    const json = render(
      "overview",
      result({}, { backfillPending: true }),
    ).toJSON() as { components: { content?: string }[] };

    expect(json.components[0]?.content).toContain(
      "\n-# Importing older history",
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
      pages: buildAuditPages(result(), EVERYONE),
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

describe("overview groups", () => {
  test("findings of one type share a line", () => {
    const admin = (roleId: string): RatedFinding => ({
      finding: {
        type: "administrator_grant",
        roleId,
        holderCount: 1,
        usedPermissions: [],
        isBotRole: false,
        lowConfidence: false,
        actionableAt: null,
      },
      severity: "critical",
      tab: "roles",
    });
    const text = textOf(
      render("overview", result({ findings: [admin("51"), admin("52")] })),
    );

    expect(text.match(/Administrator/g)).toHaveLength(1);
    expect(text).toContain("2 roles have Administrator");
    expect(text).toContain("<@&51>, <@&52>");
  });
});

describe("overview with low-history findings", () => {
  test("leaves them out of counts and top findings, summarized once", () => {
    const res = result({
      findings: [
        learningFinding("41", "2026-10-27T00:00:00Z"),
        learningFinding("42", "2026-10-29T00:00:00Z"),
      ],
    });
    const text = textOf(render("overview", res));

    expect(text).not.toContain("Top findings");
    expect(text).not.toContain("High **");
    expect(text).toContain("2 roles have permissions not used yet");
  });
});

describe("fix buttons", () => {
  function fixButtonIds(container: ContainerBuilder): string[] {
    const json = container.toJSON() as {
      components: { type: number; accessory?: { custom_id?: string } }[];
    };
    return json.components
      .map((c) => c.accessory?.custom_id)
      .filter((id): id is string => id !== undefined);
  }

  test("only findings with a planned change get a Review button", () => {
    const res = result();
    const blocks = tabPages(res, "roles", EVERYONE).flat();
    const types = blocks
      .filter((b) => b.fixIndex !== null)
      .map((b) => res.report.findings[b.fixIndex as number]?.finding.type);

    expect(types.sort()).toEqual(["administrator_grant", "everyone_dangerous"]);
  });

  test("low confidence unused permissions have no button", () => {
    const blocks = tabPages(result(), "unused", EVERYONE).flat();
    const learning = blocks.find((b) =>
      b.text.includes("Not enough history yet"),
    );

    expect(learning?.fixIndex).toBeNull();
  });

  test("buttons render as section accessories with the finding index", () => {
    expect(fixButtonIds(render("channels"))).toEqual([
      "permaudit_fix:9",
      "permaudit_fix:10",
    ]);
  });
});

describe("worst-case pages", () => {
  const roleIds = [
    "111111111111111111",
    "222222222222222222",
    "333333333333333333",
  ];

  test("the longest role findings fit in 4000 characters", () => {
    const longest: Finding = {
      type: "administrator_grant",
      roleId: roleIds[0] as string,
      holderCount: 120000,
      usedPermissions: [
        "ManageGuild",
        "ManageRoles",
        "ManageWebhooks",
        "BanMembers",
        "KickMembers",
        "ManageChannels",
        "ModerateMembers",
        "MentionEveryone",
        "ManageMessages",
        "ManageThreads",
        "ManageGuildExpressions",
        "ManageEvents",
        "ManageNicknames",
        "MoveMembers",
        "MuteMembers",
        "DeafenMembers",
      ],
      isBotRole: false,
      lowConfidence: false,
      actionableAt: null,
    };
    const res = result({
      findings: Array.from({ length: 5 }, () => ({
        finding: longest,
        severity: "high" as const,
        tab: "roles" as const,
      })),
    });

    expect(textLength(render("roles", res).toJSON())).toBeLessThanOrEqual(4000);
  });
});

function learningFinding(roleId: string, until: string): RatedFinding {
  return {
    finding: {
      type: "unused_role_permission",
      roleId,
      permissions: ["KickMembers"],
      holderCount: 2,
      lowConfidence: true,
      actionableAt: new Date(until),
    },
    severity: "high",
    tab: "unused",
  };
}

describe("tabPages", () => {
  test("low-history unused findings share one note", () => {
    const res = result({
      findings: [
        learningFinding("41", "2026-10-27T00:00:00Z"),
        learningFinding("42", "2026-10-29T00:00:00Z"),
        learningFinding("43", "2026-10-28T00:00:00Z"),
      ],
    });
    const text = tabPages(res, "unused", EVERYONE)
      .flat()
      .map((b) => b.text)
      .join("\n");

    expect(text.match(/Check again after/g)).toHaveLength(1);
    expect(text).toContain(
      `<t:${new Date("2026-10-29T00:00:00Z").getTime() / 1000}:D>`,
    );
    for (const id of ["41", "42", "43"]) {
      expect(text).toContain(`<@&${id}> · Kick Members`);
    }
  });

  test("roles tab ends with the bots group", () => {
    const pages = tabPages(result(), "roles", EVERYONE);

    expect(pages.at(-1)?.[0]?.text).toBe("### Bots");
  });

  test("unused tab ends with the not-tracked note", () => {
    const pages = tabPages(result(), "unused", EVERYONE);

    expect(pages.at(-1)?.at(-1)?.text).toContain("Not tracked");
  });

  test("findings are paged by five", () => {
    const pages = tabPages(result(), "roles", EVERYONE);

    expect(pages[0]).toHaveLength(5);
  });
});
