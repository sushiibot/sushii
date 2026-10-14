import { describe, expect, mock, test } from "bun:test";
import { type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { EventEmitter } from "node:events";
import pino from "pino";
import { Err, Ok } from "ts-results";

import type {
  AuditResult,
  PermissionAuditService,
} from "../application/PermissionAuditService";
import type { PermissionChangeService } from "../application/PermissionChangeService";
import { PermissionAuditSession } from "./PermissionAuditSession";
import { PERMISSION_AUDIT_CUSTOM_IDS } from "./customIds";

const OWNER_ID = "300000000000000003";

const RESULT: AuditResult = {
  report: {
    findings: [
      {
        finding: {
          type: "everyone_dangerous",
          roleId: "1000",
          permissions: ["MentionEveryone"],
        },
        severity: "high",
        tab: "roles",
      },
    ],
    bots: [],
    notTracked: [],
  },
  context: {
    guildName: "Test",
    canViewAuditLog: true,
    historyStart: new Date(),
    backfillPending: false,
  },
  snapshot: {
    guildId: "1000",
    ownerId: "9",
    everyoneRoleId: "1000",
    mfaRequired: false,
    roles: [
      {
        id: "1000",
        name: "@everyone",
        position: 0,
        permissions: 1n << 17n,
        botUserId: null,
        createdAt: new Date(0),
        holderCount: 1,
        holderIds: [],
      },
    ],
    overwrites: [],
    memberCount: 1,
    members: new Map(),
    selfAssignable: [],
    now: new Date(),
  },
};

function setup(options: { refusal?: string; applyError?: string } = {}) {
  const collector = new EventEmitter();
  const changeService = {
    authorize: mock(() => (options.refusal ? Err(options.refusal) : Ok.EMPTY)),
    apply: mock(() =>
      options.applyError
        ? Promise.reject(new Error(options.applyError))
        : Promise.resolve(Ok({})),
    ),
  };
  const auditService = { generate: mock(() => Promise.resolve(RESULT)) };
  const interaction = {
    guildId: "1000",
    user: { id: OWNER_ID },
    editReply: mock((_options: unknown) =>
      Promise.resolve({ createMessageComponentCollector: () => collector }),
    ),
  };
  const session = new PermissionAuditSession(
    interaction as unknown as ChatInputCommandInteraction<"cached">,
    RESULT,
    auditService as unknown as PermissionAuditService,
    changeService as unknown as PermissionChangeService,
    pino({ level: "silent" }),
  );
  return { collector, interaction, session, changeService, auditService };
}

function click(userId: string, customId: string) {
  return {
    user: { id: userId },
    customId,
    guild: {},
    guildId: "1000",
    member: {},
    update: mock((_options: unknown) => Promise.resolve()),
    deferUpdate: mock(() => Promise.resolve()),
    editReply: mock((_options: unknown) => Promise.resolve()),
    reply: mock(() =>
      Promise.resolve({ delete: mock(() => Promise.resolve()) }),
    ),
    replied: false,
    deferred: false,
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("PermissionAuditSession", () => {
  test("renders into the deferred reply", async () => {
    const { interaction, session } = setup();

    await session.start();

    const [options] = interaction.editReply.mock.calls[0] as unknown as [
      { flags: number },
    ];
    expect(options.flags & MessageFlags.IsComponentsV2).toBe(
      MessageFlags.IsComponentsV2,
    );
  });

  test("expires through the original interaction when nothing was clicked", async () => {
    const { collector, interaction, session } = setup();
    await session.start();

    collector.emit("end");
    await flush();

    expect(interaction.editReply).toHaveBeenCalledTimes(2);
  });

  test("expires through the latest click, whose token is still valid", async () => {
    const { collector, interaction, session } = setup();
    await session.start();

    const button = click(OWNER_ID, PERMISSION_AUDIT_CUSTOM_IDS.tabRoles);
    collector.emit("collect", button);
    await flush();
    collector.emit("end");
    await flush();

    expect(button.update).toHaveBeenCalledTimes(1);
    expect(button.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
  });

  test("rejects other users without changing the view", async () => {
    const { collector, session } = setup();
    await session.start();

    const button = click("999", PERMISSION_AUDIT_CUSTOM_IDS.tabRoles);
    collector.emit("collect", button);
    await flush();

    expect(button.reply).toHaveBeenCalledTimes(1);
    expect(button.update).not.toHaveBeenCalled();
  });

  describe("fix flow", () => {
    function contentOf(options: unknown): string {
      return JSON.stringify(
        (options as { components: { toJSON(): unknown }[] }).components.map(
          (c) => c.toJSON(),
        ),
      );
    }

    async function openPreview(setupOptions: Parameters<typeof setup>[0] = {}) {
      const ctx = setup(setupOptions);
      await ctx.session.start();
      ctx.collector.emit(
        "collect",
        click(OWNER_ID, PERMISSION_AUDIT_CUSTOM_IDS.tabRoles),
      );
      await flush();
      const fix = click(OWNER_ID, "permaudit_fix:0");
      ctx.collector.emit("collect", fix);
      await flush();
      return { ...ctx, fix };
    }

    test("Review fix opens a preview with the diff", async () => {
      const { fix } = await openPreview();

      const preview = contentOf(fix.update.mock.calls[0]?.[0]);
      expect(preview).toContain("Remove permissions from @everyone");
      expect(preview).toContain("- Mention @everyone, @here, and All Roles");
      expect(preview).toContain("permaudit_confirm");
    });

    test("a refusal disables Confirm and explains why", async () => {
      const { fix } = await openPreview({ refusal: "You need Manage Roles." });

      const preview = contentOf(fix.update.mock.calls[0]?.[0]);
      expect(preview).toContain("You need Manage Roles.");
      expect(preview).toMatch(
        /"custom_id":"permaudit_confirm"[^}]*"disabled":true/,
      );
    });

    test("Confirm applies and shows the result before refreshing", async () => {
      const { collector, changeService, auditService } = await openPreview();

      const confirm = click(OWNER_ID, PERMISSION_AUDIT_CUSTOM_IDS.confirm);
      collector.emit("collect", confirm);
      await flush();

      expect(confirm.deferUpdate).toHaveBeenCalledTimes(1);
      expect(changeService.apply).toHaveBeenCalledTimes(1);
      expect(auditService.generate).not.toHaveBeenCalled();
      expect(contentOf(confirm.editReply.mock.calls[0]?.[0])).toContain(
        "To restore",
      );
    });

    test("Back after a change refreshes the report", async () => {
      const { collector, auditService } = await openPreview();
      collector.emit(
        "collect",
        click(OWNER_ID, PERMISSION_AUDIT_CUSTOM_IDS.confirm),
      );
      await flush();

      const back = click(OWNER_ID, PERMISSION_AUDIT_CUSTOM_IDS.back);
      collector.emit("collect", back);
      await flush();

      expect(auditService.generate).toHaveBeenCalledTimes(1);
      expect(back.deferUpdate).toHaveBeenCalledTimes(1);
      expect(contentOf(back.editReply.mock.calls[0]?.[0])).toContain(
        "permaudit_tab_roles",
      );
    });

    test("double-clicking Confirm applies once", async () => {
      const { collector, changeService } = await openPreview();

      collector.emit(
        "collect",
        click(OWNER_ID, PERMISSION_AUDIT_CUSTOM_IDS.confirm),
      );
      collector.emit(
        "collect",
        click(OWNER_ID, PERMISSION_AUDIT_CUSTOM_IDS.confirm),
      );
      await flush();

      expect(changeService.apply).toHaveBeenCalledTimes(1);
    });

    test("a Discord error shows nothing changed and skips the refresh", async () => {
      const { collector, auditService } = await openPreview({
        applyError: "Missing Permissions",
      });

      const confirm = click(OWNER_ID, PERMISSION_AUDIT_CUSTOM_IDS.confirm);
      collector.emit("collect", confirm);
      await flush();

      const shown = contentOf(confirm.editReply.mock.calls[0]?.[0]);
      expect(shown).toContain("Nothing was changed");
      expect(shown).toContain("Missing Permissions");
      expect(auditService.generate).not.toHaveBeenCalled();
    });

    test("Cancel returns to the report without applying", async () => {
      const { collector, changeService } = await openPreview();

      const cancel = click(OWNER_ID, PERMISSION_AUDIT_CUSTOM_IDS.cancel);
      collector.emit("collect", cancel);
      await flush();

      expect(changeService.apply).not.toHaveBeenCalled();
      expect(contentOf(cancel.update.mock.calls[0]?.[0])).toContain(
        "permaudit_tab_roles",
      );
    });
  });
});
