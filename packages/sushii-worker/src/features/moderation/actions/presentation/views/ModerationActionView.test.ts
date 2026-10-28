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
  describeDmStatus,
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

function textById(container: APIContainerComponent, id: number): string | null {
  const component = byId(container, id);
  return component?.type === ComponentType.TextDisplay
    ? component.content
    : null;
}

function buttons(
  container: APIContainerComponent,
): APIButtonComponentWithCustomId[] {
  return container.components
    .filter(
      (c): c is APIActionRowComponent<APIButtonComponentWithCustomId> =>
        c.type === ComponentType.ActionRow,
    )
    .flatMap((row) => row.components);
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

describe("buildActionResultMessage", () => {
  test("single target: section header with avatar, byline and template note", () => {
    const container = json(
      render({ reasonNotes: [templateNote({ id: "1", shortcut: "spam" })] }),
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

    expect(textById(container, ACTION_RESPONSE_IDS.reason)).toBe(
      `**${emojis.reason} Reason**\nSpamming invite links`,
    );
    expect(textById(container, ACTION_RESPONSE_IDS.reasonNotes)).toBe(
      "-# Used template `!spam`",
    );
    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toBe(
      `-# ${emojis.message} DM sent`,
    );

    expect(buttons(container).map((b) => [b.label, b.custom_id])).toEqual([
      ["Edit reason", "modAction/reason/edit/4822"],
      ["Delete DM", "modAction/dm/delete/4822"],
    ]);
  });

  test("no reason: Add reason is primary and the DM line says so", () => {
    const container = json(
      render({
        results: [Ok(makeCase({ reason: null }))],
        action: banAction(null),
      }),
    );

    expect(textById(container, ACTION_RESPONSE_IDS.reason)).toContain(
      "-# No reason given",
    );
    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toContain(
      "DM sent without a reason",
    );
    const [add] = buttons(container);
    expect(add.label).toBe("Add reason");
    expect(add.style).toBe(1);
  });

  test("DM not sent: no Delete DM button, reason given", () => {
    const container = json(
      render({
        results: [Ok(makeCase({ dm: null, dmIntentSource: "executor_no" }))],
      }),
    );

    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toBe(
      `-# ${emojis.message} DM not sent (you chose no DM)`,
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

  test("save prompt adds the hint and Save as template", () => {
    const container = json(render({ savePrompt: true }));

    expect(textById(container, ACTION_RESPONSE_IDS.prompt)).toContain(
      emojis.tip,
    );
    const save = buttons(container).at(-1);
    expect(save?.label).toBe("Save as template");
    expect(save?.custom_id).toBe("modAction/save/4822");
    expect(save?.style).toBe(2);
    expect(hasSavePrompt(posted(render({ savePrompt: true })))).toBe(true);
  });

  test("notes never get a save prompt", () => {
    const container = json(
      render({
        actionType: ActionType.Note,
        action: new NoteAction(
          GUILD,
          executor,
          null,
          Reason.create("watch").unwrap(),
          "unspecified",
        ),
        results: [Ok(makeCase({ actionType: ActionType.Note, dm: null }))],
        savePrompt: true,
      }),
    );

    expect(byId(container, ACTION_RESPONSE_IDS.prompt)).toBeUndefined();
    expect(byId(container, ACTION_RESPONSE_IDS.dm)).toBeUndefined();
    expect(textById(container, ACTION_RESPONSE_IDS.reason)).toContain("Note**");
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
    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toContain(
      "DM sent to 2 users",
    );
    expect(buttons(container).map((b) => [b.label, b.custom_id])).toEqual([
      ["Edit reason", "modAction/reason/edit/4822-4823"],
      ["Delete 2 DMs", "modAction/dm/delete/4822-4823"],
    ]);
  });

  test("every target failed: header only, no buttons", () => {
    const container = json(render({ results: [Err("Missing permissions")] }));

    expect(container.components).toHaveLength(1);
    expect(headerText(container)).toContain("Couldn't ban spambot");
    expect(buttons(container)).toEqual([]);
  });

  test("timeout shows the duration and end time", () => {
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
      new RegExp(`^-# ${emojis.duration} 1d · ends <t:\\d+:f>`),
    );
  });

  test("configured DM text is shown when a DM went out", () => {
    const guildConfig = GuildConfig.createDefault(GUILD);
    Object.assign(guildConfig.moderationSettings, {
      banDmText: "Appeal at example.com",
    });
    const container = json(render({ guildConfig }));

    expect(textById(container, ACTION_RESPONSE_IDS.details)).toContain(
      "> Appeal at example.com",
    );
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
    const message = render({ targets, results, action: banAction(reason) });
    const container = json(message);

    expect(allText(container).replace(/\n/g, "").length).toBeLessThanOrEqual(
      4000,
    );
    // Too many separate cases for button custom IDs.
    expect(buttons(container)).toEqual([]);
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
      emojis: { ...emojis, message_edit: "", trash: "" },
      savePrompt: true,
      now: NOW,
    }).components[0].toJSON();

    expect(
      buttons(container).every((b) => b.emoji === undefined || b.emoji.id),
    ).toBe(true);
  });

  test("no variant contains a native emoji", () => {
    const variants = [
      render(),
      render({
        savePrompt: true,
        reasonNotes: [unknownShortcutNote("x", emojis, true)],
      }),
      render({ results: [Err("nope")] }),
      render({
        targets: [makeTarget(TARGET, "a"), makeTarget(TARGET_2, "b")],
        results: [Ok(makeCase()), Err("nope")],
      }),
    ];
    for (const variant of variants) {
      expect(JSON.stringify(json(variant))).not.toMatch(NATIVE_EMOJI);
    }
  });
});

describe("describeDmStatus", () => {
  test("partial delivery keeps the failure detail", () => {
    const line = describeDmStatus(
      [
        makeCase(),
        makeCase({
          caseId: "4823",
          dm: { error: "Cannot send", failureReason: "user_blocked" },
        }),
      ],
      emojis,
    );
    expect(line).toBe(
      `${emojis.warning} DM sent to 1 of 2 users · 1 failed (they blocked sushii)`,
    );
  });

  test("deleted DMs name who deleted them", () => {
    expect(describeDmStatus([makeCase({ dmDeleted: true })], emojis)).toMatch(
      new RegExp(`DM deleted by <@${OTHER_MOD}> <t:\\d+:R>$`),
    );
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
  });
  const originalJSON = json(original);
  const reloaded = [
    makeCase({ caseId: "4822" }),
    makeCase({ caseId: "4823", userId: TARGET_2 }),
  ];

  test("keeps the header (with failed-target errors) and the reason notes", () => {
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
      "-# Used template `!spam`",
    );
    expect(rebuilt.accent_color).toBe(originalJSON.accent_color);
    expect(
      buttons(rebuilt).map((b) => [b.label, b.custom_id, b.style]),
    ).toEqual([
      ["Delete 2 DMs", "modAction/dm/deleteConfirm/4822-4823", 4],
      ["Cancel", "modAction/dm/cancel/4822-4823", 2],
    ]);
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

    expect(textById(rebuilt, ACTION_RESPONSE_IDS.reason)).toContain("Raid");
    expect(textById(rebuilt, ACTION_RESPONSE_IDS.reasonNotes)).toBe(
      `-# ${editedNote(OTHER_MOD, at)}`,
    );
  });

  test("Delete DM after an edit keeps the edit notes and drops the button", () => {
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
    expect(textById(deleted, ACTION_RESPONSE_IDS.dm)).toContain(
      "2 DMs deleted by",
    );
    expect(textById(deleted, ACTION_RESPONSE_IDS.dm)).toEndWith(
      " · mod log updated",
    );
    expect(buttons(deleted).map((b) => b.label)).toEqual(["Edit reason"]);
  });

  test("the DM override replaces the computed line", () => {
    const rebuilt = json(
      rebuildActionResponse(posted(original), {
        cases: reloaded,
        emojis,
        reasonNotes: [],
        dmOverride: "DM updated with the new reason",
        savePrompt: false,
        mode: "buttons",
      }),
    );
    expect(textById(rebuilt, ACTION_RESPONSE_IDS.dm)).toBe(
      "-# DM updated with the new reason",
    );
  });
});

describe("expiry", () => {
  test("window is 15 minutes", () => {
    const created = NOW.getTime();
    expect(isResponseExpired(created, created + 14 * 60 * 1000)).toBe(false);
    expect(isResponseExpired(created, created + 15 * 60 * 1000)).toBe(true);
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
    expect(showsExpiredLine(posted(must(expired)))).toBe(true);
    expect(expireActionResponse(posted(must(expired)))).toBeNull();
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
  });
});

describe("fix round 1", () => {
  test("a reason edited elsewhere into a longer version drops the old notes", () => {
    const original = render({
      reasonNotes: [templateNote({ id: "1", shortcut: "spam" })],
    });
    const at = new Date("2026-10-27T11:03:00.000Z");
    const rebuilt = json(
      rebuildActionResponse(posted(original), {
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

  test("several targets show each failed DM under its user", () => {
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
    expect(textById(container, ACTION_RESPONSE_IDS.dm)).toContain(
      "DM sent to 1 of 2 users",
    );
  });

  test("the byline uses the executor's username", () => {
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

  test("notes get Edit note", () => {
    const container = json(
      render({
        actionType: ActionType.Note,
        action: new NoteAction(
          GUILD,
          executor,
          null,
          Reason.create("watch").unwrap(),
          "unspecified",
        ),
        results: [Ok(makeCase({ actionType: ActionType.Note, dm: null }))],
      }),
    );

    expect(buttons(container).map((b) => b.label)).toEqual(["Edit note"]);
  });
});
