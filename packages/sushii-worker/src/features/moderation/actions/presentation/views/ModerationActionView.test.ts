import { describe, expect, test } from "bun:test";
import type {
  APIActionRowComponent,
  APIButtonComponentWithCustomId,
  APIComponentInContainer,
  APIContainerComponent,
  APIMessageTopLevelComponent,
  User,
} from "discord.js";
import { ComponentType } from "discord.js";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import {
  BanAction,
  NoteAction,
  TimeoutAction,
} from "@/features/moderation/shared/domain/entities/ModerationAction";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import type { ModerationTarget } from "@/features/moderation/shared/domain/entities/ModerationTarget";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { Duration } from "@/features/moderation/shared/domain/value-objects/Duration";
import { Reason } from "@/features/moderation/shared/domain/value-objects/Reason";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import {
  GUILD,
  MOD,
  NATIVE_EMOJI,
  OTHER_MOD,
  TARGET,
  TARGET_2,
  TARGET_3,
  makeCase,
  makeEmojis,
  makeTarget,
  makeUser,
} from "../response/testFixtures";
import {
  ACTION_RESPONSE_IDS,
  type ActionResponseMessage,
  EXPIRED_LINE,
  buildActionResultMessage,
  editedNote,
  expireActionResponse,
  hasSavePrompt,
  isResponseExpired,
  rebuildActionResponse,
  showsExpiredLine,
  templateNote,
  unknownShortcutNote,
} from "./ModerationActionView";

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("expected a value");
  }
  return value;
}

const NOW = new Date("2026-10-27T11:00:30.000Z");
const executor = makeUser(MOD, "tzuyu") as User;
const emojis = makeEmojis();

function banAction(reason: string | null = "Spamming invite links") {
  return new BanAction(
    GUILD,
    executor,
    null,
    reason ? Reason.create(reason).unwrap() : null,
    "unspecified",
  );
}

function render(
  options: {
    targets?: ModerationTarget[];
    results?: Result<ModerationCase, string>[];
    actionType?: ActionType;
    action?: ReturnType<typeof banAction> | TimeoutAction | NoteAction;
    reasonNotes?: string[];
    savePrompt?: boolean;
    guildConfig?: GuildConfig;
  } = {},
): ActionResponseMessage {
  return buildActionResultMessage({
    actionType: options.actionType ?? ActionType.Ban,
    executor,
    targets: options.targets ?? [makeTarget(TARGET, "spambot")],
    results: options.results ?? [Ok(makeCase())],
    guildConfig: options.guildConfig ?? GuildConfig.createDefault(GUILD),
    action: options.action ?? banAction(),
    emojis,
    reasonNotes: options.reasonNotes,
    savePrompt: options.savePrompt,
    now: NOW,
  });
}

function json(message: ActionResponseMessage): APIContainerComponent {
  expect(message.components).toHaveLength(1);
  return message.components[0].toJSON();
}

function posted(message: ActionResponseMessage): APIMessageTopLevelComponent[] {
  return message.components.map((c) => c.toJSON());
}

function byId(container: APIContainerComponent, id: number) {
  return container.components.find((c) => c.id === id);
}

/** A text display by id, at the top level or inside a section. */
function textById(container: APIContainerComponent, id: number): string | null {
  for (const c of container.components) {
    if (c.type === ComponentType.TextDisplay && c.id === id) {
      return c.content;
    }
    if (c.type === ComponentType.Section) {
      const nested = c.components.find((t) => t.id === id);
      if (nested) {
        return nested.content;
      }
    }
  }
  return null;
}

function sectionButton(
  container: APIContainerComponent,
  id: number,
): APIButtonComponentWithCustomId | null {
  const section = byId(container, id);
  if (
    section?.type === ComponentType.Section &&
    section.accessory.type === ComponentType.Button
  ) {
    return section.accessory as APIButtonComponentWithCustomId;
  }
  return null;
}

/** Section accessories and action row buttons, in display order. */
function buttons(
  container: APIContainerComponent,
): APIButtonComponentWithCustomId[] {
  return container.components.flatMap((c) => {
    if (
      c.type === ComponentType.Section &&
      c.accessory.type === ComponentType.Button
    ) {
      return [c.accessory as APIButtonComponentWithCustomId];
    }
    if (c.type === ComponentType.ActionRow) {
      return (c as APIActionRowComponent<APIButtonComponentWithCustomId>)
        .components;
    }
    return [];
  });
}

function allText(container: APIContainerComponent): string {
  const out: string[] = [];
  const visit = (node: unknown) => {
    const c = node as {
      type?: number;
      content?: string;
      components?: unknown[];
    };
    if (c.type === ComponentType.TextDisplay && c.content) {
      out.push(c.content);
    }
    (c.components ?? []).forEach(visit);
  };
  container.components.forEach(visit);
  return out.join("\n");
}

function headerText(container: APIContainerComponent): string {
  const header = byId(
    container,
    ACTION_RESPONSE_IDS.header,
  ) as APIComponentInContainer;
  if (header.type === ComponentType.Section) {
    return header.components.map((c) => c.content).join("\n");
  }
  if (header.type === ComponentType.TextDisplay) {
    return header.content;
  }
  throw new Error("unexpected header");
}

function countComponents(nodes: readonly unknown[]): number {
  let count = 0;
  const visit = (node: unknown) => {
    const c = node as { components?: unknown[]; accessory?: unknown };
    count += 1;
    (c.components ?? []).forEach(visit);
    if (c.accessory) {
      visit(c.accessory);
    }
  };
  nodes.forEach(visit);
  return count;
}

/** Discord's caps: 1-3 text displays per section, 40 components, 4,000 characters. */
function expectWithinLimits(container: APIContainerComponent) {
  for (const c of container.components) {
    if (c.type === ComponentType.Section) {
      expect(c.components.length).toBeGreaterThanOrEqual(1);
      expect(c.components.length).toBeLessThanOrEqual(3);
    }
  }
  expect(countComponents([container])).toBeLessThanOrEqual(40);
  expect(textChars(container)).toBeLessThanOrEqual(4000);
}

/** Every text display's content length, newlines included, as Discord counts it. */
function textChars(container: APIContainerComponent): number {
  let length = 0;
  const visit = (node: unknown) => {
    const c = node as {
      type?: number;
      content?: string;
      components?: unknown[];
    };
    if (c.type === ComponentType.TextDisplay && c.content) {
      length += c.content.length;
    }
    (c.components ?? []).forEach(visit);
  };
  container.components.forEach(visit);
  return length;
}

function withBanDmText(text: string): GuildConfig {
  const guildConfig = GuildConfig.createDefault(GUILD);
  Object.assign(guildConfig.moderationSettings, { banDmText: text });
  return guildConfig;
}

const SETTINGS_LINE =
  "-# Extra DM text is set in `/settings` → Moderation → DMs sent to members";

function noteAction() {
  return new NoteAction(
    GUILD,
    executor,
    null,
    Reason.create("watch").unwrap(),
    "unspecified",
  );
}

describe("buildActionResultMessage", () => {
  test("single target: header, reason section with Edit reason, DM section with Delete DM", () => {
    const container = json(
      render({
        reasonNotes: [templateNote({ id: "1", shortcut: "spam" })],
        guildConfig: withBanDmText("You can appeal at https://appeal.example"),
      }),
    );

    const header = byId(container, ACTION_RESPONSE_IDS.header);
    expect(header?.type).toBe(ComponentType.Section);
    if (header?.type === ComponentType.Section) {
      expect(header.accessory.type).toBe(ComponentType.Thumbnail);
    }
    const text = headerText(container);
    expect(text).toContain(`### ${emojis.ban} Banned spambot`);
    expect(text).toContain(`<@${TARGET}> · \`${TARGET}\``);
    expect(text).toContain(`-# Case #4822 · by <@${MOD}> (tzuyu) · <t:`);

    expect(container.components.map((c) => [c.type, c.id ?? null])).toEqual([
      [ComponentType.Section, ACTION_RESPONSE_IDS.header],
      [ComponentType.Separator, null],
      [ComponentType.Section, ACTION_RESPONSE_IDS.reasonSection],
      [ComponentType.Separator, null],
      [ComponentType.Section, ACTION_RESPONSE_IDS.dmSection],
    ]);

    expect(textById(container, ACTION_RESPONSE_IDS.reason)).toBe(
      "**Reason**\nSpamming invite links",
    );
    expect(textById(container, ACTION_RESPONSE_IDS.reasonNotes)).toBe(
      "-# Template `!spam`",
    );
    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toBe(
      "**DM sent** · what they received:\n> Spamming invite links\n> You can appeal at https://appeal.example",
    );
    expect(textById(container, ACTION_RESPONSE_IDS.dmFooter)).toBe(
      SETTINGS_LINE,
    );

    const edit = must(
      sectionButton(container, ACTION_RESPONSE_IDS.reasonSection),
    );
    expect([edit.label, edit.custom_id, edit.style]).toEqual([
      "Edit reason",
      "modAction/reason/edit/4822",
      2,
    ]);
    const del = must(sectionButton(container, ACTION_RESPONSE_IDS.dmSection));
    expect([del.label, del.custom_id, del.style]).toEqual([
      "Delete DM",
      "modAction/dm/delete/4822",
      2,
    ]);
    expectWithinLimits(container);
  });

  test("without extra DM text the quote is the reason only", () => {
    const container = json(render());

    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toBe(
      "**DM sent** · what they received:\n> Spamming invite links",
    );
    const dm = byId(container, ACTION_RESPONSE_IDS.dmSection);
    expect(dm?.type === ComponentType.Section && dm.components.length).toBe(2);
  });

  test("a long reason shows only its cut first line in the DM quote", () => {
    const reason =
      "Repeated harassment of other members after two prior warnings:\n- Sent unsolicited DMs to 4 members";
    const container = json(
      render({
        results: [Ok(makeCase({ reason }))],
        action: banAction(reason),
      }),
    );

    expect(textById(container, ACTION_RESPONSE_IDS.reason)).toBe(
      `**Reason**\n${reason}`,
    );
    const quote = must(textById(container, ACTION_RESPONSE_IDS.dm)).split("\n");
    expect(quote).toHaveLength(2);
    expect(quote[1]).toStartWith("> Repeated harassment of other members");
    expect(quote[1]).toEndWith("…");
    expect(quote[1].length).toBeLessThanOrEqual(2 + 60);
  });

  test("a short multi-line reason still marks the DM quote as cut", () => {
    const reason = "Spam\nmore detail";
    const container = json(
      render({
        results: [Ok(makeCase({ reason }))],
        action: banAction(reason),
      }),
    );

    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toEndWith("\n> Spam…");
  });

  test("the DM quote escapes markdown", () => {
    const reason = "# __big__ spam";
    const container = json(
      render({
        results: [Ok(makeCase({ reason }))],
        action: banAction(reason),
      }),
    );

    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toContain(
      "> \\# \\_\\_big\\_\\_ spam",
    );
  });

  test("attachments share the notes line", () => {
    const withFiles = makeCase();
    Object.assign(withFiles, {
      _attachments: ["https://cdn.example/proof-1.png"],
    });
    const container = json(
      render({
        results: [Ok(withFiles)],
        reasonNotes: [templateNote({ id: "1", shortcut: "invites" })],
      }),
    );

    expect(textById(container, ACTION_RESPONSE_IDS.reasonNotes)).toBe(
      `-# Template \`!invites\` · ${emojis.attachment} [proof-1.png](https://cdn.example/proof-1.png)`,
    );
    expect(byId(container, ACTION_RESPONSE_IDS.details)).toBeUndefined();
  });

  test("no reason: Add reason is primary and the DM says no reason was included", () => {
    const container = json(
      render({
        results: [Ok(makeCase({ reason: null }))],
        action: banAction(null),
      }),
    );

    expect(textById(container, ACTION_RESPONSE_IDS.reason)).toBe(
      "**Reason**\n-# No reason given",
    );
    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toBe(
      "**DM sent** · no reason was included",
    );
    const add = must(
      sectionButton(container, ACTION_RESPONSE_IDS.reasonSection),
    );
    expect(add.label).toBe("Add reason");
    expect(add.style).toBe(1);
    expect(sectionButton(container, ACTION_RESPONSE_IDS.dmSection)?.label).toBe(
      "Delete DM",
    );
  });

  test("DM not sent: plain text, no Delete DM", () => {
    const container = json(
      render({
        results: [Ok(makeCase({ dm: null, dmIntentSource: "executor_no" }))],
      }),
    );

    const dm = byId(container, ACTION_RESPONSE_IDS.dm);
    expect(dm?.type).toBe(ComponentType.TextDisplay);
    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toBe(
      "**DM not sent** · you chose no DM",
    );
    expect(byId(container, ACTION_RESPONSE_IDS.dmSection)).toBeUndefined();
    expect(buttons(container).map((b) => b.label)).toEqual(["Edit reason"]);
  });

  test("DM off in /settings", () => {
    const container = json(
      render({
        results: [Ok(makeCase({ dm: null, dmIntentSource: "guild_default" }))],
      }),
    );
    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toBe(
      "**DM not sent** · off in `/settings`",
    );
  });

  test("DM failed: plain text with the reason", () => {
    const container = json(
      render({
        results: [
          Ok(
            makeCase({
              dm: {
                error: "Cannot send",
                failureReason: "user_cannot_receive",
              },
            }),
          ),
        ],
      }),
    );

    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toBe(
      "**DM failed** · they have DMs off or blocked sushii",
    );
    expect(buttons(container).map((b) => b.label)).toEqual(["Edit reason"]);
  });

  test("DM deleted: who and when, no button", () => {
    const container = json(
      render({ results: [Ok(makeCase({ dmDeleted: true }))] }),
    );

    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toMatch(
      new RegExp(`^\\*\\*DM deleted\\*\\* by <@${OTHER_MOD}> <t:\\d+:R>$`),
    );
    expect(buttons(container).map((b) => b.label)).toEqual(["Edit reason"]);
  });

  test("unknown shortcut note points at Edit reason", () => {
    const note = unknownShortcutNote("spma", emojis, true);
    const container = json(render({ reasonNotes: [note] }));

    expect(textById(container, ACTION_RESPONSE_IDS.reasonNotes)).toBe(
      `-# ${emojis.warning} No template \`!spma\`, so the text was used as typed and DMed like that. Fix it with Edit reason; you can update the DM there too.`,
    );
  });

  test("save prompt adds the hint and only a Save as template row", () => {
    const container = json(render({ savePrompt: true }));

    expect(textById(container, ACTION_RESPONSE_IDS.prompt)).toContain(
      emojis.tip,
    );
    const rows = container.components.filter(
      (c) => c.type === ComponentType.ActionRow,
    );
    expect(rows).toHaveLength(1);
    const save = buttons(container).at(-1);
    expect(save?.label).toBe("Save as template");
    expect(save?.custom_id).toBe("modAction/save/4822");
    expect(save?.style).toBe(2);
    expect(hasSavePrompt(posted(render({ savePrompt: true })))).toBe(true);
  });

  test("no save prompt: no action row at all", () => {
    const container = json(render());
    expect(
      container.components.some((c) => c.type === ComponentType.ActionRow),
    ).toBe(false);
  });

  test("notes: Edit note, no DM part and no save prompt", () => {
    const container = json(
      render({
        actionType: ActionType.Note,
        action: noteAction(),
        results: [Ok(makeCase({ actionType: ActionType.Note, dm: null }))],
        savePrompt: true,
      }),
    );

    expect(byId(container, ACTION_RESPONSE_IDS.prompt)).toBeUndefined();
    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toBeNull();
    expect(textById(container, ACTION_RESPONSE_IDS.reason)).toStartWith(
      "**Note**\n",
    );
    expect(buttons(container).map((b) => b.label)).toEqual(["Edit note"]);
    expect(
      container.components.filter((c) => c.type === ComponentType.Separator),
    ).toHaveLength(1);
  });

  test("a note without text gets Add note", () => {
    const container = json(
      render({
        actionType: ActionType.Note,
        action: noteAction(),
        results: [
          Ok(makeCase({ actionType: ActionType.Note, dm: null, reason: null })),
        ],
      }),
    );
    expect(buttons(container).map((b) => b.label)).toEqual(["Add note"]);
  });

  test("several targets with a partial failure", () => {
    const container = json(
      render({
        targets: [
          makeTarget(TARGET, "spambot"),
          makeTarget(TARGET_2, "spambot2"),
          makeTarget(TARGET_3, "raider_99"),
        ],
        results: [
          Ok(makeCase({ caseId: "4822" })),
          Ok(makeCase({ caseId: "4823", userId: TARGET_2 })),
          Err("their highest role is above sushii's"),
        ],
      }),
    );

    const text = headerText(container);
    expect(byId(container, ACTION_RESPONSE_IDS.header)?.type).toBe(
      ComponentType.TextDisplay,
    );
    expect(text).toContain(`### ${emojis.warning} Banned 2 of 3 users`);
    expect(text).toContain(`${emojis.success} <@${TARGET}> · \`${TARGET}\``);
    expect(text).toContain(
      `${emojis.fail} <@${TARGET_3}> · \`${TARGET_3}\`\n-# ↳ Couldn't ban raider\\_99: their highest role is above sushii's`,
    );
    expect(text).toContain("Cases #4822–#4823");
    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toStartWith(
      "**DM sent** to 2 of 2 · what they received:",
    );
    expect(buttons(container).map((b) => [b.label, b.custom_id])).toEqual([
      ["Edit reason", "modAction/reason/edit/4822-4823"],
      ["Delete 2 DMs", "modAction/dm/delete/4822-4823"],
    ]);
  });

  test("several targets: a failed DM stays under its user", () => {
    const container = json(
      render({
        targets: [
          makeTarget(TARGET, "spambot"),
          makeTarget(TARGET_2, "spambot2"),
        ],
        results: [
          Ok(makeCase()),
          Ok(
            makeCase({
              caseId: "4823",
              userId: TARGET_2,
              dm: { error: "Cannot send", failureReason: "user_blocked" },
            }),
          ),
        ],
      }),
    );

    expect(headerText(container)).toContain(
      `${emojis.success} <@${TARGET_2}> · \`${TARGET_2}\`\n-# ↳ DM failed: they blocked sushii`,
    );
    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toStartWith(
      "**DM sent** to 1 of 2 · what they received:",
    );
    expect(sectionButton(container, ACTION_RESPONSE_IDS.dmSection)?.label).toBe(
      "Delete DM",
    );
  });

  test("several targets, every DM deleted", () => {
    const container = json(
      render({
        targets: [
          makeTarget(TARGET, "spambot"),
          makeTarget(TARGET_2, "spambot2"),
        ],
        results: [
          Ok(makeCase({ dmDeleted: true })),
          Ok(makeCase({ caseId: "4823", userId: TARGET_2, dmDeleted: true })),
        ],
      }),
    );
    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toMatch(
      /^\*\*2 DMs deleted\*\* by/,
    );
  });

  test("every target failed: header only, no buttons", () => {
    const container = json(render({ results: [Err("Missing permissions")] }));

    expect(container.components).toHaveLength(1);
    expect(headerText(container)).toContain("Couldn't ban spambot");
    expect(buttons(container)).toEqual([]);
  });

  test("timeout shows the duration and end time above the separator", () => {
    const action = new TimeoutAction(
      GUILD,
      executor,
      null,
      Reason.create("nsfw").unwrap(),
      "unspecified",
      null,
      must(Duration.create("1d").unwrap()),
    );
    const container = json(
      render({
        actionType: ActionType.Timeout,
        action,
        results: [Ok(makeCase({ actionType: ActionType.Timeout }))],
      }),
    );

    expect(headerText(container)).toContain("Timed out spambot");
    expect(textById(container, ACTION_RESPONSE_IDS.details)).toMatch(
      new RegExp(`^-# ${emojis.duration} 1d · ends <t:\\d+:f>$`),
    );
    expect(container.components[1].id).toBe(ACTION_RESPONSE_IDS.details);
  });

  test("kick shows the kick DM text", () => {
    const guildConfig = GuildConfig.createDefault(GUILD);
    Object.assign(guildConfig.moderationSettings, { kickDmText: "Bye" });
    const container = json(
      render({
        actionType: ActionType.Kick,
        guildConfig,
        results: [Ok(makeCase({ actionType: ActionType.Kick }))],
      }),
    );
    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toEndWith(
      "\n> Spamming invite links\n> Bye",
    );
  });

  test("an adjusted timeout quotes the timeout DM text", () => {
    const guildConfig = GuildConfig.createDefault(GUILD);
    Object.assign(guildConfig.moderationSettings, { timeoutDmText: "Muted" });
    const container = json(
      render({
        actionType: ActionType.TimeoutAdjust,
        guildConfig,
        results: [Ok(makeCase({ actionType: ActionType.TimeoutAdjust }))],
      }),
    );
    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toEndWith("\n> Muted");
    expect(textById(container, ACTION_RESPONSE_IDS.dmFooter)).toBe(
      SETTINGS_LINE,
    );
  });

  test("the /settings hint only shows for actions with a DM text setting", () => {
    const untimeout = json(
      render({
        actionType: ActionType.TimeoutRemove,
        results: [Ok(makeCase({ actionType: ActionType.TimeoutRemove }))],
      }),
    );
    expect(textById(untimeout, ACTION_RESPONSE_IDS.dm)).toStartWith(
      "**DM sent**",
    );
    expect(textById(untimeout, ACTION_RESPONSE_IDS.dmFooter)).toBeNull();
    expect(allText(untimeout)).not.toContain("/settings");
    expectWithinLimits(untimeout);

    const unban = json(
      render({
        actionType: ActionType.BanRemove,
        results: [Ok(makeCase({ actionType: ActionType.BanRemove }))],
      }),
    );
    expect(textById(unban, ACTION_RESPONSE_IDS.dm)).toBeNull();
    expect(allText(unban)).not.toContain("/settings");

    for (const actionType of [
      ActionType.Warn,
      ActionType.Timeout,
      ActionType.TempBan,
      ActionType.Softban,
      ActionType.Kick,
    ]) {
      const container = json(
        render({ actionType, results: [Ok(makeCase({ actionType }))] }),
      );
      expect(textById(container, ACTION_RESPONSE_IDS.dmFooter)).toBe(
        SETTINGS_LINE,
      );
    }
  });

  test("a reason starting with a blank line quotes its first non-empty line", () => {
    const reason = "\n  \nSpam links\nmore";
    const container = json(
      render({
        results: [Ok(makeCase({ reason }))],
        action: banAction(reason),
      }),
    );
    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toBe(
      "**DM sent** · what they received:\n> Spam links…",
    );

    const padded = "\nSpam links";
    const single = json(
      render({
        results: [Ok(makeCase({ reason: padded }))],
        action: banAction(padded),
      }),
    );
    expect(textById(single, ACTION_RESPONSE_IDS.dm)).toEndWith(
      "\n> Spam links",
    );
  });

  test("mixed DMs where none went out and none were deleted say none were sent", () => {
    const container = json(
      render({
        targets: [makeTarget(TARGET, "a"), makeTarget(TARGET_2, "b")],
        results: [
          Ok(makeCase({ dm: { error: "x", failureReason: "user_blocked" } })),
          Ok(
            makeCase({
              caseId: "4823",
              userId: TARGET_2,
              dm: null,
              dmIntentSource: "executor_no",
            }),
          ),
        ],
      }),
    );
    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toBe(
      "**No DMs sent** · 1 failed · 1 not sent",
    );

    const withDeleted = json(
      render({
        targets: [makeTarget(TARGET, "a"), makeTarget(TARGET_2, "b")],
        results: [
          Ok(makeCase({ dmDeleted: true })),
          Ok(
            makeCase({
              caseId: "4823",
              userId: TARGET_2,
              dm: { error: "x", failureReason: "user_blocked" },
            }),
          ),
        ],
      }),
    );
    expect(textById(withDeleted, ACTION_RESPONSE_IDS.dm)).toStartWith(
      "**No DMs left** · 1 deleted",
    );
  });

  test("25 consecutive targets with a max-length reason fit in every mode", () => {
    const reason = "x".repeat(3000);
    const targets = Array.from({ length: 25 }, (_, i) =>
      makeTarget(`9123456789012345${String(i).padStart(2, "0")}`, `user_${i}`),
    );
    const cases = targets.map((t, i) =>
      makeCase({
        caseId: `${10000 + i}`,
        userId: t.id,
        userTag: t.user.username,
        reason,
      }),
    );
    const full = render({
      targets,
      results: cases.map((c) => Ok(c)),
      action: banAction(reason),
      guildConfig: withBanDmText("z".repeat(2000)),
      reasonNotes: [templateNote({ id: "1", shortcut: "spam" })],
      savePrompt: true,
    });
    const buttonsMode = json(full);
    expect(buttons(buttonsMode).length).toBeGreaterThan(0);
    expectWithinLimits(buttonsMode);

    const confirming = rebuildActionResponse(posted(full), {
      cases,
      emojis,
      savePrompt: true,
      mode: "confirmDeleteDm",
    });
    expect(buttons(json(confirming)).map((b) => b.label)).toContain("Cancel");
    expectWithinLimits(json(confirming));

    const expiredRebuild = rebuildActionResponse(posted(full), {
      cases,
      emojis,
      savePrompt: true,
      mode: "expired",
    });
    expectWithinLimits(json(expiredRebuild));

    for (const from of [full, confirming]) {
      const expired = json(must(expireActionResponse(posted(from))));
      expect(textById(expired, ACTION_RESPONSE_IDS.footer)).toBe(EXPIRED_LINE);
      expectWithinLimits(expired);
    }
  });

  test("a single target at the limit still fits once expired or confirming", () => {
    const reason = "x".repeat(3000);
    const message = render({
      results: [Ok(makeCase({ reason }))],
      action: banAction(reason),
      guildConfig: withBanDmText("z".repeat(2000)),
      reasonNotes: ["n".repeat(600)],
    });
    expect(textChars(json(message))).toBeGreaterThan(3900);
    expectWithinLimits(json(must(expireActionResponse(posted(message)))));
    expectWithinLimits(
      json(
        rebuildActionResponse(posted(message), {
          cases: [makeCase({ reason })],
          emojis,
          savePrompt: false,
          mode: "confirmDeleteDm",
        }),
      ),
    );
  });

  test("long extra DM text is bounded", () => {
    const container = json(
      render({ guildConfig: withBanDmText("y".repeat(2000)) }),
    );
    const [, , extra] = must(textById(container, ACTION_RESPONSE_IDS.dm)).split(
      "\n",
    );
    expect(extra).toStartWith("> yyy");
    expect(extra.length).toBeLessThanOrEqual(500);
  });

  test("25 targets with a max-length reason stay under 4,000 characters", () => {
    const reason = "x".repeat(3000);
    const targets = Array.from({ length: 25 }, (_, i) =>
      makeTarget(`9123456789012345${String(i).padStart(2, "0")}`, `user_${i}`),
    );
    const results = targets.map((t, i) =>
      i % 2 === 0
        ? Ok(makeCase({ caseId: `${10000 + i * 3}`, userId: t.id, reason }))
        : Err(
            "their highest role is above sushii's and some more detail here to pad",
          ),
    );
    const message = render({
      targets,
      results,
      action: banAction(reason),
      guildConfig: withBanDmText("z".repeat(2000)),
    });
    const container = json(message);

    expectWithinLimits(container);
    // Too many separate cases for button custom IDs.
    expect(buttons(container)).toEqual([]);
    expect(byId(container, ACTION_RESPONSE_IDS.reasonSection)).toBeUndefined();
    expect(byId(container, ACTION_RESPONSE_IDS.dmSection)).toBeUndefined();
    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toStartWith(
      "**DM sent** to 13 of 13",
    );
    expect(textById(container, ACTION_RESPONSE_IDS.footer)).toContain(
      "too spread out",
    );
  });

  test("a missing bot emoji never reaches setEmoji", () => {
    const container = buildActionResultMessage({
      actionType: ActionType.Ban,
      executor,
      targets: [makeTarget(TARGET, "spambot")],
      results: [Ok(makeCase())],
      guildConfig: GuildConfig.createDefault(GUILD),
      action: banAction(),
      emojis: { ...emojis, message_edit: "", trash: "", save: "" },
      savePrompt: true,
      now: NOW,
    }).components[0].toJSON();

    expect(buttons(container)).toHaveLength(3);
    expect(
      buttons(container).every((b) => b.emoji === undefined || b.emoji.id),
    ).toBe(true);
  });

  test("no variant contains a native emoji, and all serialize", () => {
    const variants = [
      render(),
      render({
        savePrompt: true,
        reasonNotes: [unknownShortcutNote("x", emojis, true)],
        guildConfig: withBanDmText("Appeal"),
      }),
      render({ results: [Err("nope")] }),
      render({
        targets: [makeTarget(TARGET, "a"), makeTarget(TARGET_2, "b")],
        results: [Ok(makeCase()), Err("nope")],
      }),
      render({ results: [Ok(makeCase({ dmDeleted: true }))] }),
    ];
    for (const variant of variants) {
      const container = json(variant);
      expect(JSON.stringify(container)).not.toMatch(NATIVE_EMOJI);
      expectWithinLimits(container);
    }
  });
});

describe("rebuildActionResponse", () => {
  const original = render({
    targets: [
      makeTarget(TARGET, "spambot"),
      makeTarget(TARGET_2, "spambot2"),
      makeTarget(TARGET_3, "raider_99"),
    ],
    results: [
      Ok(makeCase({ caseId: "4822" })),
      Ok(makeCase({ caseId: "4823", userId: TARGET_2 })),
      Err("their highest role is above sushii's"),
    ],
    reasonNotes: [templateNote({ id: "1", shortcut: "spam" })],
    guildConfig: withBanDmText("Appeal at example.com"),
  });
  const originalJSON = json(original);
  const reloaded = [
    makeCase({ caseId: "4822" }),
    makeCase({ caseId: "4823", userId: TARGET_2 }),
  ];

  test("confirm mode keeps the header, notes and DM text, without Delete DM", () => {
    const rebuilt = json(
      rebuildActionResponse(posted(original), {
        cases: reloaded,
        emojis,
        savePrompt: false,
        mode: "confirmDeleteDm",
      }),
    );

    expect(textById(rebuilt, ACTION_RESPONSE_IDS.header)).toBe(
      textById(originalJSON, ACTION_RESPONSE_IDS.header),
    );
    expect(textById(rebuilt, ACTION_RESPONSE_IDS.reasonNotes)).toBe(
      "-# Template `!spam`",
    );
    expect(rebuilt.accent_color).toBe(originalJSON.accent_color);
    expect(byId(rebuilt, ACTION_RESPONSE_IDS.dmSection)).toBeUndefined();
    expect(textById(rebuilt, ACTION_RESPONSE_IDS.dm)).toBe(
      textById(originalJSON, ACTION_RESPONSE_IDS.dm),
    );
    expect(textById(rebuilt, ACTION_RESPONSE_IDS.dm)).toEndWith(
      "\n> Appeal at example.com",
    );
    expect(
      buttons(rebuilt).map((b) => [b.label, b.custom_id, b.style]),
    ).toEqual([
      ["Edit reason", "modAction/reason/edit/4822-4823", 2],
      ["Delete 2 DMs", "modAction/dm/deleteConfirm/4822-4823", 4],
      ["Cancel", "modAction/dm/cancel/4822-4823", 2],
    ]);
    expectWithinLimits(rebuilt);
  });

  test("Cancel restores the DM section", () => {
    const confirming = rebuildActionResponse(posted(original), {
      cases: reloaded,
      emojis,
      savePrompt: false,
      mode: "confirmDeleteDm",
    });
    const restored = json(
      rebuildActionResponse(posted(confirming), {
        cases: reloaded,
        emojis,
        savePrompt: false,
        mode: "buttons",
      }),
    );

    expect(restored.components).toEqual(originalJSON.components);
  });

  test("keeps the single-target section header and its thumbnail", () => {
    const single = render();
    const rebuilt = json(
      rebuildActionResponse(posted(single), {
        cases: [makeCase()],
        emojis,
        savePrompt: false,
        mode: "buttons",
      }),
    );

    expect(byId(rebuilt, ACTION_RESPONSE_IDS.header)).toEqual(
      byId(json(single), ACTION_RESPONSE_IDS.header),
    );
  });

  test("a reason changed elsewhere drops the old notes for Edited by", () => {
    const at = new Date("2026-10-27T11:03:00.000Z");
    const rebuilt = json(
      rebuildActionResponse(posted(original), {
        cases: reloaded.map(() =>
          makeCase({ reason: "Raid", reasonSetBy: OTHER_MOD, reasonSetAt: at }),
        ),
        emojis,
        savePrompt: false,
        mode: "buttons",
      }),
    );

    expect(textById(rebuilt, ACTION_RESPONSE_IDS.reason)).toBe(
      "**Reason**\nRaid",
    );
    expect(textById(rebuilt, ACTION_RESPONSE_IDS.reasonNotes)).toBe(
      `-# ${editedNote(OTHER_MOD, at)}`,
    );
  });

  test("a reason edited elsewhere into a longer version drops the old notes", () => {
    const single = render({
      reasonNotes: [templateNote({ id: "1", shortcut: "spam" })],
    });
    const at = new Date("2026-10-27T11:03:00.000Z");
    const rebuilt = json(
      rebuildActionResponse(posted(single), {
        cases: [
          makeCase({
            reason: "Spamming invite links in #general too",
            reasonSetBy: OTHER_MOD,
            reasonSetAt: at,
          }),
        ],
        emojis,
        savePrompt: false,
        mode: "buttons",
      }),
    );

    expect(textById(rebuilt, ACTION_RESPONSE_IDS.reasonNotes)).toBe(
      `-# ${editedNote(OTHER_MOD, at)}`,
    );
  });

  test("an edit that left the DM alone keeps quoting what was sent", () => {
    const edited = rebuildActionResponse(posted(original), {
      cases: reloaded.map((c) =>
        makeCase({ caseId: c.caseId, userId: c.userId, reason: "New reason" }),
      ),
      emojis,
      reasonNotes: [editedNote(OTHER_MOD, NOW)],
      dmOverride: "DMs not updated: the users still see the original reason",
      savePrompt: false,
      mode: "buttons",
    });
    const editedJSON = json(edited);
    expect(textById(editedJSON, ACTION_RESPONSE_IDS.reason)).toBe(
      "**Reason**\nNew reason",
    );
    expect(textById(editedJSON, ACTION_RESPONSE_IDS.dm)).toEndWith(
      "\n> Spamming invite links\n> Appeal at example.com",
    );
    expect(textById(editedJSON, ACTION_RESPONSE_IDS.dmFooter)).toBe(
      `-# DMs not updated: the users still see the original reason\n${SETTINGS_LINE}`,
    );

    // A later click rebuilds from that message and still quotes the old DM.
    const clicked = json(
      rebuildActionResponse(posted(edited), {
        cases: reloaded.map((c) =>
          makeCase({
            caseId: c.caseId,
            userId: c.userId,
            reason: "New reason",
          }),
        ),
        emojis,
        savePrompt: false,
        mode: "confirmDeleteDm",
      }),
    );
    expect(textById(clicked, ACTION_RESPONSE_IDS.dm)).toEndWith(
      "\n> Spamming invite links\n> Appeal at example.com",
    );
    expect(textById(clicked, ACTION_RESPONSE_IDS.reasonNotes)).toBe(
      `-# ${editedNote(OTHER_MOD, NOW)}`,
    );
  });

  test("an edit that updated the DM quotes the new reason", () => {
    const rebuilt = json(
      rebuildActionResponse(posted(original), {
        cases: reloaded.map((c) =>
          makeCase({
            caseId: c.caseId,
            userId: c.userId,
            reason: "New reason",
          }),
        ),
        emojis,
        reasonNotes: [],
        dmOverride: "DMs updated with the new reason",
        dmReasonUpdated: true,
        savePrompt: false,
        mode: "buttons",
      }),
    );
    expect(textById(rebuilt, ACTION_RESPONSE_IDS.dm)).toBe(
      "**DM sent** to 2 of 2 · what they received:\n> New reason\n> Appeal at example.com",
    );
  });

  test("adding a reason to a DM sent without one", () => {
    const bare = render({
      results: [Ok(makeCase({ reason: null }))],
      action: banAction(null),
    });
    const notUpdated = json(
      rebuildActionResponse(posted(bare), {
        cases: [makeCase({ reason: "Late reason" })],
        emojis,
        reasonNotes: [],
        savePrompt: false,
        mode: "buttons",
      }),
    );
    expect(textById(notUpdated, ACTION_RESPONSE_IDS.dm)).toBe(
      "**DM sent** · no reason was included",
    );
    expect(buttons(notUpdated)[0].label).toBe("Edit reason");

    const updated = json(
      rebuildActionResponse(posted(bare), {
        cases: [makeCase({ reason: "Late reason" })],
        emojis,
        reasonNotes: [],
        dmReasonUpdated: true,
        savePrompt: false,
        mode: "buttons",
      }),
    );
    expect(textById(updated, ACTION_RESPONSE_IDS.dm)).toBe(
      "**DM sent** · what they received:\n> Late reason",
    );
  });

  test("a DM without a reason keeps its extra DM text across rebuilds", () => {
    const bare = render({
      results: [Ok(makeCase({ reason: null }))],
      action: banAction(null),
      guildConfig: withBanDmText("Appeal"),
    });
    const expected = "**DM sent** · no reason was included\n> Appeal";
    expect(textById(json(bare), ACTION_RESPONSE_IDS.dm)).toBe(expected);

    const rebuilt = json(
      rebuildActionResponse(posted(bare), {
        cases: [makeCase({ reason: "Late reason" })],
        emojis,
        reasonNotes: [],
        savePrompt: false,
        mode: "buttons",
      }),
    );
    expect(textById(rebuilt, ACTION_RESPONSE_IDS.dm)).toBe(expected);
  });

  test("notes with attachments round-trip without doubling the attachments", () => {
    const withFiles = () => {
      const c = makeCase();
      Object.assign(c, { _attachments: ["https://cdn.example/proof-1.png"] });
      return c;
    };
    const first = render({
      results: [Ok(withFiles())],
      reasonNotes: [templateNote({ id: "1", shortcut: "spam" })],
    });
    const rebuilt = json(
      rebuildActionResponse(posted(first), {
        cases: [withFiles()],
        emojis,
        savePrompt: false,
        mode: "buttons",
      }),
    );
    expect(textById(rebuilt, ACTION_RESPONSE_IDS.reasonNotes)).toBe(
      textById(json(first), ACTION_RESPONSE_IDS.reasonNotes),
    );

    const attachmentsOnly = render({ results: [Ok(withFiles())] });
    const again = json(
      rebuildActionResponse(posted(attachmentsOnly), {
        cases: [withFiles()],
        emojis,
        savePrompt: false,
        mode: "buttons",
      }),
    );
    expect(textById(again, ACTION_RESPONSE_IDS.reasonNotes)).toBe(
      `-# ${emojis.attachment} [proof-1.png](https://cdn.example/proof-1.png)`,
    );
  });

  test("Delete DM after an edit keeps the edit notes and drops the section button", () => {
    const edited = rebuildActionResponse(posted(original), {
      cases: reloaded,
      emojis,
      reasonNotes: [editedNote(OTHER_MOD, NOW, " · mod log updated")],
      savePrompt: false,
      mode: "buttons",
    });
    const deleted = json(
      rebuildActionResponse(posted(edited), {
        cases: reloaded.map((c) =>
          makeCase({ caseId: c.caseId, dmDeleted: true }),
        ),
        emojis,
        savePrompt: false,
        dmSuffix: " · mod log updated",
        mode: "buttons",
      }),
    );

    expect(textById(deleted, ACTION_RESPONSE_IDS.reasonNotes)).toContain(
      "Edited by",
    );
    expect(textById(deleted, ACTION_RESPONSE_IDS.dm)).toMatch(
      /^\*\*2 DMs deleted\*\* by .* · mod log updated$/,
    );
    expect(byId(deleted, ACTION_RESPONSE_IDS.dm)?.type).toBe(
      ComponentType.TextDisplay,
    );
    expect(buttons(deleted).map((b) => b.label)).toEqual(["Edit reason"]);
  });

  test("a partial delete keeps Delete DM for the rest and notes the deleted one", () => {
    const rebuilt = json(
      rebuildActionResponse(posted(original), {
        cases: [
          makeCase({ caseId: "4822", dmDeleted: true }),
          makeCase({ caseId: "4823", userId: TARGET_2 }),
        ],
        emojis,
        savePrompt: false,
        dmSuffix: " · mod log updated",
        mode: "buttons",
      }),
    );

    expect(textById(rebuilt, ACTION_RESPONSE_IDS.dm)).toStartWith(
      "**DM sent** to 1 of 2 · what they received:",
    );
    expect(textById(rebuilt, ACTION_RESPONSE_IDS.dmFooter)).toMatch(
      new RegExp(
        `^-# 1 deleted by <@${OTHER_MOD}> <t:\\d+:R> · mod log updated\n`,
      ),
    );
    expect(sectionButton(rebuilt, ACTION_RESPONSE_IDS.dmSection)?.label).toBe(
      "Delete DM",
    );
  });

  test("an override on a gone DM goes under the DM line", () => {
    const rebuilt = json(
      rebuildActionResponse(posted(render()), {
        cases: [makeCase({ dmDeleted: true })],
        emojis,
        reasonNotes: [],
        dmOverride: "Couldn't update the DM",
        savePrompt: false,
        mode: "buttons",
      }),
    );
    expect(textById(rebuilt, ACTION_RESPONSE_IDS.dm)).toEndWith(
      "\n-# Couldn't update the DM",
    );
  });

  test("Delete DM confirm keeps the save prompt line, Cancel restores the button", () => {
    const withPrompt = render({ savePrompt: true });
    const confirming = rebuildActionResponse(posted(withPrompt), {
      cases: [makeCase()],
      emojis,
      savePrompt: true,
      mode: "confirmDeleteDm",
    });
    expect(hasSavePrompt(posted(confirming))).toBe(true);
    expect(buttons(json(confirming)).map((b) => b.label)).toEqual([
      "Edit reason",
      "Delete DM",
      "Cancel",
    ]);

    const cancelled = rebuildActionResponse(posted(confirming), {
      cases: [makeCase()],
      emojis,
      savePrompt: true,
      mode: "buttons",
    });
    expect(json(cancelled).components).toEqual(json(withPrompt).components);
  });

  test("an old-layout response rebuilds into the new layout", () => {
    const old: APIMessageTopLevelComponent[] = [
      {
        type: ComponentType.Container,
        accent_color: 0xff0000,
        components: [
          {
            type: ComponentType.TextDisplay,
            id: ACTION_RESPONSE_IDS.header,
            content: "### Banned spambot",
          },
          { type: ComponentType.Separator, id: 1 },
          {
            type: ComponentType.TextDisplay,
            id: ACTION_RESPONSE_IDS.reason,
            content: `**${emojis.message} Reason**\nSpamming invite links`,
          },
          {
            type: ComponentType.TextDisplay,
            id: ACTION_RESPONSE_IDS.reasonNotes,
            content: "-# Used template `!spam`",
          },
          {
            type: ComponentType.TextDisplay,
            id: ACTION_RESPONSE_IDS.details,
            content: `-# ${emojis.duration} 1d · ends <t:1793098804:f>\n-# Additional DM text, from \`/settings\`:\n> Appeal here\n-# [proof.png](https://cdn.example/proof.png)`,
          },
          {
            type: ComponentType.TextDisplay,
            id: ACTION_RESPONSE_IDS.dm,
            content: `-# ${emojis.message} DM sent`,
          },
          { type: ComponentType.Separator, id: 2 },
          {
            type: ComponentType.ActionRow,
            id: 3,
            components: [
              {
                type: ComponentType.Button,
                id: 4,
                style: 2,
                label: "Edit reason",
                custom_id: "modAction/reason/edit/4822",
              },
            ],
          },
        ],
      } as APIMessageTopLevelComponent,
    ];

    const rebuilt = json(
      rebuildActionResponse(old, {
        cases: [makeCase()],
        emojis,
        savePrompt: false,
        mode: "buttons",
      }),
    );
    expect(textById(rebuilt, ACTION_RESPONSE_IDS.details)).toBe(
      `-# ${emojis.duration} 1d · ends <t:1793098804:f>`,
    );
    expect(textById(rebuilt, ACTION_RESPONSE_IDS.reason)).toBe(
      "**Reason**\nSpamming invite links",
    );
    expect(textById(rebuilt, ACTION_RESPONSE_IDS.reasonNotes)).toBe(
      "-# Used template `!spam`",
    );
    expect(textById(rebuilt, ACTION_RESPONSE_IDS.dm)).toBe(
      "**DM sent** · what they received:\n> Spamming invite links\n> Appeal here",
    );
    expect(buttons(rebuilt).map((b) => b.label)).toEqual([
      "Edit reason",
      "Delete DM",
    ]);
    expectWithinLimits(rebuilt);

    expect(
      json(must(expireActionResponse(old))).components.some(
        (c) => c.type === ComponentType.ActionRow,
      ),
    ).toBe(false);
  });
});

describe("expiry", () => {
  test("window is 15 minutes", () => {
    const created = NOW.getTime();
    expect(isResponseExpired(created, created + 14 * 60 * 1000)).toBe(false);
    expect(isResponseExpired(created, created + 15 * 60 * 1000)).toBe(true);
  });

  test("a response without a save prompt still expires and loses both accessories", () => {
    const message = render({ guildConfig: withBanDmText("Appeal") });
    const expired = expireActionResponse(posted(message));
    expect(expired).not.toBeNull();

    const container = json(must(expired));
    expect(buttons(container)).toEqual([]);
    expect(
      container.components.some(
        (c) =>
          c.type === ComponentType.Section &&
          c.id !== ACTION_RESPONSE_IDS.header,
      ),
    ).toBe(false);
    for (const id of [
      ACTION_RESPONSE_IDS.reason,
      ACTION_RESPONSE_IDS.dm,
      ACTION_RESPONSE_IDS.dmFooter,
    ]) {
      expect(byId(container, id)?.type).toBe(ComponentType.TextDisplay);
      expect(textById(container, id)).toBe(textById(json(message), id));
    }
    expect(container.components.at(-2)?.type).toBe(ComponentType.Separator);
    expect(textById(container, ACTION_RESPONSE_IDS.footer)).toBe(EXPIRED_LINE);
    expect(showsExpiredLine(posted(must(expired)))).toBe(true);
    expect(expireActionResponse(posted(must(expired)))).toBeNull();
  });

  test("expired render strips buttons and the save prompt, once", () => {
    const message = render({ savePrompt: true });
    const expired = expireActionResponse(posted(message));
    expect(expired).not.toBeNull();

    const container = json(must(expired));
    expect(buttons(container)).toEqual([]);
    expect(byId(container, ACTION_RESPONSE_IDS.prompt)).toBeUndefined();
    expect(textById(container, ACTION_RESPONSE_IDS.footer)).toBe(EXPIRED_LINE);
    expect(textById(container, ACTION_RESPONSE_IDS.header)).toBe(
      textById(json(message), ACTION_RESPONSE_IDS.header),
    );
    expect(
      container.components.filter((c) => c.type === ComponentType.Separator),
    ).toHaveLength(3);
  });

  test("expired rebuild matches the timer's expired render", () => {
    const message = render({ savePrompt: true });
    const rebuilt = json(
      rebuildActionResponse(posted(message), {
        cases: [makeCase()],
        emojis,
        savePrompt: true,
        mode: "expired",
      }),
    );
    expect(rebuilt.components).toEqual(
      json(must(expireActionResponse(posted(message)))).components,
    );
  });

  test("the confirm prompt goes away too", () => {
    const confirming = rebuildActionResponse(posted(render()), {
      cases: [makeCase()],
      emojis,
      savePrompt: false,
      mode: "confirmDeleteDm",
    });
    const container = json(must(expireActionResponse(posted(confirming))));
    expect(allText(container)).not.toContain("Delete the DM");
    expect(buttons(container)).toEqual([]);
    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toStartWith(
      "**DM sent**",
    );
  });

  test("an expired response still rebuilds from its text displays", () => {
    const message = render({
      reasonNotes: [templateNote({ id: "1", shortcut: "spam" })],
    });
    const expired = must(expireActionResponse(posted(message)));
    const rebuilt = json(
      rebuildActionResponse(posted(expired), {
        cases: [makeCase()],
        emojis,
        savePrompt: false,
        mode: "expired",
      }),
    );
    expect(textById(rebuilt, ACTION_RESPONSE_IDS.reasonNotes)).toBe(
      "-# Template `!spam`",
    );
    expect(textById(rebuilt, ACTION_RESPONSE_IDS.dm)).toBe(
      textById(json(message), ACTION_RESPONSE_IDS.dm),
    );
  });

  test("a response without buttons never gets the expired line", () => {
    const targets = Array.from({ length: 13 }, (_, i) =>
      makeTarget(`9123456789012345${String(i).padStart(2, "0")}`, `u${i}`),
    );
    const message = render({
      targets,
      results: targets.map((t, i) =>
        Ok(makeCase({ caseId: `${10000 + i * 3}`, userId: t.id })),
      ),
    });

    expect(expireActionResponse(posted(message))).toBeNull();
  });
});

describe("byline", () => {
  test("uses the executor's username", () => {
    const container = buildActionResultMessage({
      actionType: ActionType.Ban,
      executor: { ...makeUser(MOD, "tzuyu"), tag: "tzuyu#0001" } as User,
      targets: [makeTarget(TARGET, "spambot")],
      results: [Ok(makeCase())],
      guildConfig: GuildConfig.createDefault(GUILD),
      action: banAction(),
      emojis,
      now: NOW,
    }).components[0].toJSON();

    expect(headerText(container)).toContain("(tzuyu)");
    expect(headerText(container)).not.toContain("#0001");
  });
});
