import { describe, expect, test } from "bun:test";
import type {
  APIActionRowComponent,
  APIButtonComponentWithCustomId,
  APIContainerComponent,
  APIMediaGalleryComponent,
  APISectionComponent,
} from "discord.js";
import { ButtonStyle, ComponentType, MessageFlags } from "discord.js";

import type { DMResult } from "../../domain/entities/ModerationCase";
import { ModerationCase } from "../../domain/entities/ModerationCase";
import { ActionType } from "../../domain/value-objects/ActionType";
import { Reason } from "../../domain/value-objects/Reason";
import {
  MOD_LOG_EMOJIS,
  MOD_LOG_FACTS_ID,
  type ModLogEmojis,
  type ModLogMessageInput,
  buildDeleteDmConfirm,
  buildLegacyConversionBody,
  buildModLogMessage,
  extractFactsBlock,
  extractLegacyFacts,
  isLegacyEntryWithDeletedDm,
} from "./ModLogMessageView";
import { parseModLogDmButtonId } from "./modLogCustomIds";

const GUILD = "187450744427773963";
const TARGET = "912345678901234567";
const EXECUTOR = "150443906511667200";
const SETTER = "238381427315195904";
const DM_CHANNEL = "1029384756102938400";
const DM_MESSAGE = "1029384756102938401";
const ACTION_TIME = new Date("2026-10-27T11:00:00.000Z");
const ACTION_UNIX = ACTION_TIME.getTime() / 1000;

const emojis = Object.fromEntries(
  MOD_LOG_EMOJIS.map((name, i) => [name, `<:${name}:14000000000000002${i}>`]),
) as ModLogEmojis;

const NATIVE_EMOJI = /\p{Extended_Pictographic}/u;

interface CaseOptions {
  actionType?: ActionType;
  executorId?: string | null;
  reason?: string | null;
  attachments?: string[];
  dmResult?: DMResult | null;
  timeoutDuration?: number | null;
  dmNotAttemptedReason?: "user_not_in_guild" | null;
  dmFailureReason?: "user_blocked" | null;
  deleteMessageSeconds?: number | null;
  dmDeleted?: boolean;
  dmDeletedBy?: string | null;
  dmDeletedAt?: Date | null;
  reasonSetBy?: string | null;
  reasonSetAt?: Date | null;
}

function makeCase(o: CaseOptions = {}): ModerationCase {
  return new ModerationCase(
    GUILD,
    "4822",
    o.actionType ?? ActionType.Ban,
    ACTION_TIME,
    TARGET,
    "spambot",
    o.executorId === undefined ? EXECUTOR : o.executorId,
    o.reason ? Reason.create(o.reason).unwrap() : null,
    "1029384756102938499",
    o.attachments ?? [],
    o.dmResult ?? null,
    false,
    o.timeoutDuration ?? null,
    false,
    "unknown",
    false,
    o.dmNotAttemptedReason ?? null,
    o.dmFailureReason ?? null,
    o.deleteMessageSeconds ?? null,
    o.dmDeleted ?? false,
    o.reasonSetBy ?? null,
    o.reasonSetAt ?? null,
    o.dmDeletedBy ?? null,
    o.dmDeletedAt ?? null,
  );
}

function render(
  moderationCase: ModerationCase,
  extra: Partial<ModLogMessageInput> = {},
): APIContainerComponent {
  const message = buildModLogMessage({
    moderationCase,
    target: {
      id: TARGET,
      username: "spambot",
      avatarURL: "https://cdn.discordapp.com/embed/avatars/4.png",
    },
    emojis,
    ...extra,
  });

  expect(message.flags).toBe(MessageFlags.IsComponentsV2);
  expect(message.allowedMentions).toEqual({ parse: [] });
  expect(message.components).toHaveLength(1);

  return message.components[0]?.toJSON();
}

function texts(container: APIContainerComponent): string[] {
  const out: string[] = [];
  for (const child of container.components) {
    if (child.type === ComponentType.TextDisplay) {
      out.push(child.content);
    } else if (child.type === ComponentType.Section) {
      out.push(...child.components.map((c) => c.content));
    }
  }
  return out;
}

function allText(container: APIContainerComponent): string {
  return texts(container).join("\n");
}

function buttons(
  container: APIContainerComponent,
): APIButtonComponentWithCustomId[] {
  const row = container.components.find(
    (c) => c.type === ComponentType.ActionRow,
  ) as APIActionRowComponent<APIButtonComponentWithCustomId> | undefined;
  return row?.components ?? [];
}

const liveDm: DMResult = { channelId: DM_CHANNEL, messageId: DM_MESSAGE };

describe("buildModLogMessage", () => {
  test("notes read as a note, with Edit note", () => {
    const container = render(
      makeCase({ actionType: ActionType.Note, reason: "Watch for alts" }),
    );

    expect(allText(container)).toContain("**Note**\nWatch for alts");
    expect(allText(container)).not.toContain("**Reason**");
    expect(buttons(container).map((b) => b.label)).toEqual(["Edit note"]);
  });

  test("a note without text offers Set note", () => {
    const container = render(makeCase({ actionType: ActionType.Note }));

    expect(allText(container)).toContain("-# No note yet.");
    expect(buttons(container).map((b) => b.label)).toEqual(["Set note"]);
  });

  test("the timestamp is a footer under the buttons", () => {
    const container = render(makeCase({ reason: "Raid" }));
    const last = container.components.at(-1);
    const beforeLast = container.components.at(-2);

    expect(last).toMatchObject({
      type: ComponentType.TextDisplay,
      content: `-# <t:${ACTION_UNIX}:f>`,
    });
    expect(beforeLast?.type).toBe(ComponentType.ActionRow);
  });

  test("native ban without a reason offers Set reason only", () => {
    const container = render(makeCase());

    const section = container.components[0] as APISectionComponent;
    expect(section.type).toBe(ComponentType.Section);
    expect(section.accessory).toMatchObject({
      type: ComponentType.Thumbnail,
      media: { url: "https://cdn.discordapp.com/embed/avatars/4.png" },
    });
    expect(section.components[0]?.content).toBe(
      `### ${emojis.ban} Banned · Case #4822\n**User:** <@${TARGET}>\n-# spambot · \`${TARGET}\`\n**Moderator:** <@${EXECUTOR}>`,
    );

    expect(allText(container)).toContain(
      "-# No reason yet. Set one so the case history explains this action.",
    );
    expect(allText(container)).toContain(
      `-# ${emojis.message} No DM sent\n-# <t:${ACTION_UNIX}:f>`,
    );

    expect(buttons(container)).toEqual([
      {
        type: ComponentType.Button,
        style: ButtonStyle.Primary,
        label: "Set reason",
        custom_id: `/modlog/reason/4822`,
        emoji: {
          id: /:(\d+)>$/.exec(emojis.message_edit)?.[1],
          name: "message_edit",
          animated: false,
        },
      },
    ]);
  });

  test("reason with a live DM offers Edit reason and Delete DM", () => {
    const container = render(
      makeCase({
        reason: "Spamming in channels (rule 3).",
        dmResult: liveDm,
        deleteMessageSeconds: 3600,
      }),
    );

    expect(allText(container)).toContain(
      "**Reason**\nSpamming in channels (rule 3).",
    );
    expect(allText(container)).toContain(
      `-# ${emojis.trash} Deleted messages from the previous hour`,
    );
    expect(allText(container)).toContain(`-# ${emojis.message} Reason DM sent`);

    const [edit, deleteDm] = buttons(container);
    expect(edit).toMatchObject({
      label: "Edit reason",
      style: ButtonStyle.Secondary,
      custom_id: "/modlog/reason/4822",
    });
    expect(deleteDm).toMatchObject({
      label: "Delete DM",
      style: ButtonStyle.Secondary,
    });
    expect(parseModLogDmButtonId(deleteDm?.custom_id)).toEqual({
      action: "delete",
      caseId: "4822",
    });
    expect(deleteDm?.custom_id).toBe(
      `/modlog/rmDM/4822/${DM_CHANNEL}/${DM_MESSAGE}`,
    );
  });

  test("deleted DM hides Delete DM and names who deleted it when known", () => {
    const moderationCase = makeCase({
      reason: "Spam",
      dmResult: liveDm,
      dmDeleted: true,
    });
    const at = new Date("2026-10-27T11:59:40.000Z");

    const plain = render(moderationCase);
    expect(allText(plain)).toContain(`-# ${emojis.message} Reason DM deleted`);
    expect(buttons(plain).map((b) => b.label)).toEqual(["Edit reason"]);

    const withWho = render(
      makeCase({
        reason: "Spam",
        dmResult: liveDm,
        dmDeleted: true,
        dmDeletedBy: SETTER,
        dmDeletedAt: at,
      }),
    );
    expect(allText(withWho)).toContain(
      `Reason DM deleted by <@${SETTER}> <t:${at.getTime() / 1000}:R>`,
    );
  });

  test("failed DM shows the failure reason", () => {
    const container = render(
      makeCase({
        actionType: ActionType.Warn,
        reason: "Arguing with mods",
        dmResult: {
          error: "User has blocked the bot",
          failureReason: "user_blocked",
        },
        dmFailureReason: "user_blocked",
      }),
    );

    expect(allText(container)).toContain(
      `-# ${emojis.fail} Reason DM failed: they have DMs off or blocked sushii`,
    );
    expect(allText(container)).toContain(`### ${emojis.warn} Warned`);
  });

  test("member not in the server", () => {
    const container = render(
      makeCase({ dmNotAttemptedReason: "user_not_in_guild" }),
    );

    expect(allText(container)).toContain(
      "No DM sent: they weren't in the server",
    );
  });

  test("notes and unbans have no DM line but still get a set button", () => {
    for (const [actionType, label] of [
      [ActionType.Note, "Set note"],
      [ActionType.BanRemove, "Set reason"],
    ] as const) {
      const container = render(makeCase({ actionType }));
      expect(allText(container)).not.toContain("DM");
      expect(buttons(container).map((b) => b.label)).toEqual([label]);
    }
  });

  test("reason set later notes who set it and keeps the executor", () => {
    const at = new Date("2026-10-27T11:59:40.000Z");
    const container = render(
      makeCase({ reason: "Raid", reasonSetBy: SETTER, reasonSetAt: at }),
    );

    expect(allText(container)).toContain(`**Moderator:** <@${EXECUTOR}>`);
    expect(allText(container)).toContain(
      `Raid\n-# Set by <@${SETTER}> <t:${at.getTime() / 1000}:R>`,
    );
  });

  test("a reason set by the moderator who acted has no extra note", () => {
    const at = new Date("2026-10-27T11:59:40.000Z");
    const container = render(
      makeCase({ reason: "Raid", reasonSetBy: EXECUTOR, reasonSetAt: at }),
    );

    expect(allText(container)).not.toContain("Set by");
  });

  test("missing executor falls back to the given id", () => {
    const container = render(makeCase({ executorId: null }), {
      fallbackExecutorId: "1",
    });
    expect(allText(container)).toContain("**Moderator:** <@1>");

    const noFallback = render(makeCase({ executorId: null }));
    expect(allText(noFallback)).not.toContain("**Moderator:**");
    expect(allText(noFallback)).toContain(`\n-# <t:${ACTION_UNIX}:f>`);
  });

  test("timeout shows the duration and end from the stored duration", () => {
    const container = render(
      makeCase({
        actionType: ActionType.Timeout,
        reason: "Spam",
        timeoutDuration: 86400,
      }),
    );

    expect(allText(container)).toContain(
      `-# ${emojis.duration} 1 day · ends <t:${ACTION_UNIX + 86400}:f>`,
    );
    expect(allText(container)).toContain(`### ${emojis.timeout} Timed out`);
  });

  test("tempban shows the duration", () => {
    const container = render(
      makeCase({ actionType: ActionType.TempBan, timeoutDuration: 604800 }),
    );

    expect(allText(container)).toContain(
      `7 days · ends <t:${ACTION_UNIX + 604800}:f>`,
    );
  });

  test("softban with no deleted messages says so", () => {
    const container = render(
      makeCase({ actionType: ActionType.Softban, deleteMessageSeconds: 0 }),
    );

    expect(allText(container)).toContain("-# No messages deleted");
  });

  test("image attachments go in a gallery, other files as links", () => {
    const container = render(
      makeCase({
        attachments: [
          "https://cdn.discordapp.com/attachments/1/2/evidence.png?ex=abc",
          "https://cdn.discordapp.com/attachments/1/2/log.txt",
        ],
      }),
    );

    const gallery = container.components.find(
      (c) => c.type === ComponentType.MediaGallery,
    ) as APIMediaGalleryComponent;
    expect(gallery.items).toEqual([
      {
        media: {
          url: "https://cdn.discordapp.com/attachments/1/2/evidence.png?ex=abc",
        },
      },
    ]);
    expect(allText(container)).toContain(
      "-# Attachments: [log.txt](https://cdn.discordapp.com/attachments/1/2/log.txt)",
    );
  });

  test("confirm state swaps the buttons for Delete DM / Cancel", () => {
    const container = render(makeCase({ reason: "Spam", dmResult: liveDm }), {
      confirmDeleteDm: true,
    });

    expect(allText(container)).toContain(
      "**Delete the DM sent to spambot?** They won't see the reason anymore. The case and its reason stay.",
    );
    const [confirm, cancel] = buttons(container);
    expect(confirm).toMatchObject({
      label: "Delete DM",
      style: ButtonStyle.Danger,
      custom_id: "modLog/dm/deleteConfirm/4822",
    });
    expect(cancel).toMatchObject({
      label: "Cancel",
      style: ButtonStyle.Secondary,
      custom_id: "modLog/dm/cancel/4822",
    });
  });

  test("missing emoji leave no empty emoji or stray spaces", () => {
    const blank = Object.fromEntries(
      MOD_LOG_EMOJIS.map((name) => [name, ""]),
    ) as ModLogEmojis;
    const container = render(makeCase({ dmResult: liveDm, reason: "x" }), {
      emojis: blank,
    });

    for (const b of buttons(container)) {
      expect(b.emoji).toBeUndefined();
    }
    expect(allText(container)).toContain("### Banned · Case #4822");
    expect(allText(container)).toContain("**Reason**\nx");
  });

  test("never uses native emoji", () => {
    const variants = [
      makeCase(),
      makeCase({ reason: "Spam", dmResult: liveDm, deleteMessageSeconds: 60 }),
      makeCase({ dmDeleted: true, dmResult: liveDm }),
      makeCase({ dmResult: { error: "x" }, dmFailureReason: "user_blocked" }),
      makeCase({ actionType: ActionType.Timeout, timeoutDuration: 600 }),
      makeCase({ actionType: ActionType.Softban, deleteMessageSeconds: 0 }),
    ];

    for (const moderationCase of variants) {
      expect(JSON.stringify(render(moderationCase))).not.toMatch(NATIVE_EMOJI);
      expect(
        JSON.stringify(render(moderationCase, { confirmDeleteDm: true })),
      ).not.toMatch(NATIVE_EMOJI);
    }
  });

  test("stays within Discord's 4000 character text limit", () => {
    const container = render(
      makeCase({
        actionType: ActionType.Timeout,
        reason: "r".repeat(3000),
        timeoutDuration: 86400,
        dmResult: { error: "x" },
        dmFailureReason: "user_blocked",
        reasonSetBy: SETTER,
        reasonSetAt: ACTION_TIME,
        attachments: Array.from(
          { length: 20 },
          (_, i) =>
            `https://cdn.discordapp.com/attachments/1/2/${"f".repeat(60)}${i}.txt`,
        ),
      }),
      {
        target: {
          id: TARGET,
          username: "_".repeat(32),
          avatarURL: "https://cdn.discordapp.com/embed/avatars/4.png",
        },
        confirmDeleteDm: true,
      },
    );

    const total = texts(container).reduce((sum, t) => sum + t.length, 0);
    expect(total).toBeLessThanOrEqual(4000);
    expect(allText(container)).toContain("…");
  });

  test("escapes markdown in the target name", () => {
    const container = render(makeCase(), {
      target: {
        id: TARGET,
        username: "evil_*name*",
        avatarURL: "https://cdn.discordapp.com/embed/avatars/4.png",
      },
    });

    expect(allText(container)).toContain("evil\\_\\*name\\*");
  });
});

describe("buildLegacyConversionBody", () => {
  test("adds the v2 flag and clears embeds and content with null", () => {
    const message = buildModLogMessage({
      moderationCase: makeCase(),
      target: {
        id: TARGET,
        username: "spambot",
        avatarURL: "https://x.test/a.png",
      },
      emojis,
    });

    expect(buildLegacyConversionBody(message, 0)).toEqual({
      flags: MessageFlags.IsComponentsV2,
      components: message.components.map((c) => c.toJSON()),
      embeds: [],
      content: null,
      allowed_mentions: { parse: [] },
    });
  });

  test("keeps SuppressEmbeds and drops flags an edit can't send", () => {
    const message = buildModLogMessage({
      moderationCase: makeCase(),
      target: {
        id: TARGET,
        username: "spambot",
        avatarURL: "https://x.test/a.png",
      },
      emojis,
    });

    expect(
      buildLegacyConversionBody(
        message,
        MessageFlags.SuppressEmbeds | MessageFlags.Crossposted,
      ).flags,
    ).toBe(MessageFlags.SuppressEmbeds | MessageFlags.IsComponentsV2);
  });
});

describe("preserved facts", () => {
  test("the executor's tag sits under the mention", () => {
    const container = render(makeCase(), { executorTag: "tzuyu_*" });

    expect(allText(container)).toContain(
      `**Moderator:** <@${EXECUTOR}>\n-# tzuyu\\_\\*`,
    );
  });

  test("the facts block has a stable id and a re-render can copy it", () => {
    const first = render(
      makeCase({ actionType: ActionType.Timeout, timeoutDuration: 600 }),
    );
    const block = extractFactsBlock({ components: [first] });
    expect(block).toContain("10 minutes");
    expect(
      first.components.some(
        (c) => (c as { id?: number }).id === MOD_LOG_FACTS_ID,
      ),
    ).toBe(true);

    const copied = render(makeCase({ actionType: ActionType.TimeoutRemove }), {
      factsBlock: "-# Timeout would have ended <t:9:R>",
    });
    expect(allText(copied)).toContain("Timeout would have ended <t:9:R>");
  });

  test("a timeout change from the audit log wins over a copied block", () => {
    const container = render(
      makeCase({ actionType: ActionType.Timeout, timeoutDuration: 600 }),
      {
        factsBlock: "-# stale",
        timeoutChange: { actionType: ActionType.Timeout } as never,
      },
    );

    expect(allText(container)).not.toContain("stale");
    expect(allText(container)).toContain("10 minutes");
  });

  test("legacy fields the row can't rebuild are carried over verbatim", () => {
    const embeds = [
      {
        fields: [
          { name: "User timeout adjust", value: "<@1> x" },
          { name: "Timeout Duration", value: "1 hour\nExpiring <t:5:R>" },
          { name: "Previous Timeout", value: "Would have expired <t:3:R>" },
          { name: "Removed Timeout", value: "Would have expired <t:4:R>" },
        ],
      },
    ];

    expect(
      extractLegacyFacts(
        { embeds },
        makeCase({ actionType: ActionType.TimeoutAdjust }),
      ),
    ).toEqual([
      "Timeout Duration: 1 hour · Expiring <t:5:R>",
      "Previous Timeout: Would have expired <t:3:R>",
      "Removed Timeout: Would have expired <t:4:R>",
    ]);

    // A stored duration is rendered from the row instead.
    expect(
      extractLegacyFacts(
        { embeds },
        makeCase({
          actionType: ActionType.TimeoutAdjust,
          timeoutDuration: 3600,
        }),
      ),
    ).toEqual([
      "Previous Timeout: Would have expired <t:3:R>",
      "Removed Timeout: Would have expired <t:4:R>",
    ]);

    const many = Array.from({ length: 40 }, () => ({
      name: "Previous Timeout",
      value: "Would have expired <t:3:R>",
    }));
    const capped = extractLegacyFacts(
      { embeds: [{ fields: many }] },
      makeCase({ actionType: ActionType.TimeoutAdjust }),
    );
    expect(capped.join("").length).toBeLessThanOrEqual(600);
    expect(capped.length).toBeGreaterThan(0);

    const container = render(makeCase(), {
      extraFacts: ["Previous Timeout: Would have expired <t:3:R>"],
    });
    expect(allText(container)).toContain(
      "-# Previous Timeout: Would have expired <t:3:R>",
    );
  });
});

describe("buildDeleteDmConfirm", () => {
  test("names the DM count for several recipients", () => {
    const { prompt, row } = buildDeleteDmConfirm({
      recipient: { count: 2 },
      confirmCustomId: "c",
      cancelCustomId: "x",
    });

    expect(prompt.toJSON().content).toBe(
      "**Delete the 2 DMs sent by this action?** They won't see the reason anymore. The case and its reason stay.",
    );
    expect(
      row.toJSON().components.map((b) => (b as { label: string }).label),
    ).toEqual(["Delete 2 DMs", "Cancel"]);
  });
});

describe("isLegacyEntryWithDeletedDm", () => {
  const row = (label: string) => ({
    toJSON: () => ({ type: 1, components: [{ type: 2, label }] }),
  });
  const flags = (bits: number) => ({
    has: (flag: MessageFlags) => (bits & flag) === flag,
  });

  test("matches an embed entry with the disabled Reason DM deleted button", () => {
    expect(
      isLegacyEntryWithDeletedDm({
        flags: flags(0),
        components: [row("Reason DM deleted")],
      }),
    ).toBe(true);
  });

  test("ignores live legacy entries and components v2 entries", () => {
    expect(
      isLegacyEntryWithDeletedDm({
        flags: flags(0),
        components: [row("Reason DM sent")],
      }),
    ).toBe(false);
    expect(
      isLegacyEntryWithDeletedDm({
        flags: flags(MessageFlags.IsComponentsV2),
        components: [row("Reason DM deleted")],
      }),
    ).toBe(false);
  });
});
