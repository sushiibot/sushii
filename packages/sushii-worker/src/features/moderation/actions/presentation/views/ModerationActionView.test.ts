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

import type { CaseProof } from "@/features/moderation/shared/domain/entities/CaseProof";
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
  LIVE_DM_BUTTON_ID_BASE,
  PROOF_TEXT_ID_BASE,
  buildActionResultMessage,
  editedNote,
  expireActionResponse,
  hasSavePrompt,
  isResponseExpired,
  postedResponseDiffers,
  postedStaleUrl,
  rebuildActionResponse,
  showsExpiredLine,
  staleActionResponse,
  staleLine,
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
    upload?: string;
    guildConfig?: GuildConfig;
    proofs?: CaseProof[];
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
    upload: options.upload,
    proofs: options.proofs,
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

function noteAction() {
  return new NoteAction(
    GUILD,
    executor,
    null,
    Reason.create("watch").unwrap(),
    "unspecified",
  );
}

const MOD_LOG_URL =
  "https://discord.com/channels/187450744427773963/1029384756102938400/1029384756102938499";

function proof(overrides: Partial<CaseProof> = {}): CaseProof {
  return {
    id: "1",
    guildId: GUILD,
    caseId: "4822",
    authorId: MOD,
    createdAt: new Date("2026-10-27T11:00:00.000Z"),
    content: "Reported in #reports",
    attachments: [],
    sourceMessageUrl: null,
    sourceAuthorId: null,
    sourceContent: null,
    hostMessageId: null,
    source: "button",
    ...overrides,
  };
}

function reasonText(container: APIContainerComponent): string {
  return must(textById(container, ACTION_RESPONSE_IDS.reason));
}

function proofTextComponent(container: APIContainerComponent) {
  for (const c of container.components) {
    const texts =
      c.type === ComponentType.Section
        ? c.components
        : c.type === ComponentType.TextDisplay
          ? [c]
          : [];
    const found = texts.find(
      (t) => (t.id ?? 0) >= PROOF_TEXT_ID_BASE && (t.id ?? 0) < 3000,
    );
    if (found) {
      return found;
    }
  }
  return null;
}

function proofText(container: APIContainerComponent): string {
  return must(proofTextComponent(container)).content;
}

function topLevelTypes(container: APIContainerComponent): (number | string)[] {
  return container.components.map((c) => c.id ?? c.type);
}

function manyTargets(count: number) {
  return Array.from({ length: count }, (_, i) =>
    makeTarget(`9123456789012345${String(i).padStart(2, "0")}`, `user_${i}`),
  );
}

function rebuild(
  from: ActionResponseMessage,
  body: Partial<Parameters<typeof rebuildActionResponse>[1]> & {
    cases: ModerationCase[];
  },
) {
  return rebuildActionResponse(posted(from), {
    proofs: [],
    emojis,
    savePrompt: false,
    mode: "buttons",
    ...body,
  });
}

describe("buildActionResultMessage", () => {
  test("single target: reason block, its row, then the proof section", () => {
    const container = json(render({ proofs: [proof()] }));

    expect(topLevelTypes(container)).toEqual([
      ACTION_RESPONSE_IDS.header,
      ComponentType.Separator,
      ACTION_RESPONSE_IDS.reason,
      ACTION_RESPONSE_IDS.reasonRow,
      ComponentType.Separator,
      ACTION_RESPONSE_IDS.proofSection,
    ]);
    expect(reasonText(container)).toBe(
      `**${emojis.dm_sent} Reason** · sent to spambot by DM\nSpamming invite links`,
    );
    expect(buttons(container).map((b) => [b.label, b.custom_id])).toEqual([
      ["Edit reason", "modAction/reason/edit/4822"],
      ["Delete DM", "modAction/dm/delete/4822"],
      ["Add proof", "caseProof/add/4822"],
    ]);
    expect(
      sectionButton(container, ACTION_RESPONSE_IDS.proofSection)?.label,
    ).toBe("Add proof");
    expectWithinLimits(container);
  });

  test("there is no DM preview and the extra DM text is never quoted", () => {
    const container = json(
      render({ guildConfig: withBanDmText("Appeal at example.com") }),
    );
    const all = allText(container);

    expect(all).not.toContain("what they received");
    expect(all).not.toContain("Appeal at example.com");
    expect(all).not.toContain("\n> ");
    expect(reasonText(container)).toEndWith(
      "\n-# Also included your server's ban message",
    );
  });

  test("without extra DM text there is no 'also included' line", () => {
    expect(reasonText(json(render()))).not.toContain("Also included");
  });

  test("kick and timeout name their own DM text", () => {
    const guildConfig = GuildConfig.createDefault(GUILD);
    Object.assign(guildConfig.moderationSettings, {
      kickDmText: "Bye",
      timeoutDmText: "Cool off",
    });
    const kick = json(
      render({
        actionType: ActionType.Kick,
        results: [Ok(makeCase({ actionType: ActionType.Kick }))],
        guildConfig,
      }),
    );
    expect(reasonText(kick)).toContain(
      "-# Also included your server's kick message",
    );

    const adjusted = json(
      render({
        actionType: ActionType.TimeoutAdjust,
        results: [Ok(makeCase({ actionType: ActionType.TimeoutAdjust }))],
        guildConfig,
      }),
    );
    expect(reasonText(adjusted)).toContain(
      "-# Also included your server's timeout message",
    );
  });

  test("a 3,000 character reason is shown once, in full", () => {
    const reason = `${"Line one of a long reason.\n".repeat(20)}${"x".repeat(2460)}`;
    expect(reason.length).toBe(3000);
    const container = json(
      render({
        results: [Ok(makeCase({ reason }))],
        action: banAction(reason),
        guildConfig: withBanDmText("z".repeat(2000)),
      }),
    );

    expect(reasonText(container)).toContain(`\n${reason}\n`);
    expect(allText(container).split(reason)).toHaveLength(2);
    expectWithinLimits(container);
  });

  test("no reason: Add reason is primary", () => {
    const container = json(
      render({
        results: [Ok(makeCase({ reason: null }))],
        action: banAction(null),
      }),
    );
    expect(reasonText(container)).toContain("\n-# No reason given");
    expect(buttons(container)[0]).toMatchObject({
      label: "Add reason",
      style: 1,
    });
  });

  test("not sent: the cause goes on a line under the reason, and only Edit reason", () => {
    const container = json(render({ results: [Ok(makeCase({ dm: null }))] }));

    expect(reasonText(container)).toBe(
      `**${emojis.reason} Reason** · not sent\nSpamming invite links\n-# Ban DMs are off in \`/settings\``,
    );
    expect(buttons(container).map((b) => b.label)).toEqual([
      "Edit reason",
      "Add proof",
    ]);
  });

  test("not sent because the mod chose no DM", () => {
    const container = json(
      render({
        results: [Ok(makeCase({ dm: null, dmIntentSource: "executor_no" }))],
      }),
    );
    expect(reasonText(container)).toEndWith(
      "\n-# DM not sent: the mod chose no DM",
    );
  });

  test("a failed DM says why", () => {
    const container = json(
      render({
        results: [
          Ok(makeCase({ dm: { error: "x", failureReason: "user_blocked" } })),
        ],
      }),
    );
    expect(reasonText(container)).toStartWith(
      `**${emojis.reason} Reason** · not sent\n`,
    );
    expect(reasonText(container)).toEndWith(
      "\n-# DM failed: they have DMs off or blocked sushii",
    );
  });

  test("a deleted DM says who deleted it, without Delete DM", () => {
    const container = json(
      render({
        results: [Ok(makeCase({ dmDeleted: true }))],
        guildConfig: withBanDmText("Appeal"),
      }),
    );
    expect(reasonText(container)).toEndWith(
      `\n-# DM deleted by <@${OTHER_MOD}> <t:1793099100:R>`,
    );
    expect(reasonText(container)).not.toContain("Also included");
    expect(buttons(container).map((b) => b.label)).not.toContain("Delete DM");
  });

  test("several targets: N users, a shared proof note and Delete N DMs", () => {
    const targets = [
      makeTarget(TARGET, "a"),
      makeTarget(TARGET_2, "b"),
      makeTarget(TARGET_3, "c"),
    ];
    const cases = targets.map((t, i) =>
      makeCase({
        caseId: `${4822 + i}`,
        userId: t.id,
        userTag: t.user.username,
      }),
    );
    const container = json(
      render({ targets, results: cases.map((c) => Ok(c)) }),
    );

    expect(reasonText(container)).toStartWith(
      `**${emojis.dm_sent} Reason** · sent to 3 users by DM\n`,
    );
    expect(proofText(container)).toContain(
      "\n-# Added proof goes on all 3 cases",
    );
    expect(buttons(container).map((b) => [b.label, b.custom_id])).toEqual([
      ["Edit reason", "modAction/reason/edit/4822-4824"],
      ["Delete 3 DMs", "modAction/dm/delete/4822-4824"],
      ["Add proof", "caseProof/add/4822-4824"],
    ]);
  });

  test("several targets with some DMs failed: N of M users", () => {
    const targets = [
      makeTarget(TARGET, "a"),
      makeTarget(TARGET_2, "b"),
      makeTarget(TARGET_3, "c"),
    ];
    const results = [
      Ok(makeCase({ caseId: "4822", userId: TARGET })),
      Ok(
        makeCase({
          caseId: "4823",
          userId: TARGET_2,
          dm: { error: "x", failureReason: "user_blocked" },
        }),
      ),
      Err("their highest role is above sushii's"),
    ];
    const container = json(render({ targets, results }));

    expect(headerText(container)).toContain("Banned 2 of 3 users");
    expect(headerText(container)).toContain(
      "DM failed: they have DMs off or blocked sushii",
    );
    expect(reasonText(container)).toStartWith(
      `**${emojis.dm_sent} Reason** · sent to 1 of 2 users by DM\n`,
    );
    expect(reasonText(container)).toContain("\n-# 1 failed");
    expect(buttons(container).map((b) => b.label)).toContain("Delete DM");
  });

  test("several targets, every DM deleted", () => {
    const cases = ["4822", "4823"].map((caseId, i) =>
      makeCase({ caseId, userId: i ? TARGET_2 : TARGET, dmDeleted: true }),
    );
    const container = json(
      render({
        targets: [makeTarget(TARGET, "a"), makeTarget(TARGET_2, "b")],
        results: cases.map((c) => Ok(c)),
      }),
    );
    expect(reasonText(container)).toContain(
      `\n-# 2 DMs deleted by <@${OTHER_MOD}>`,
    );
  });

  test("every target failed: header only, no buttons", () => {
    const container = json(render({ results: [Err("nope")] }));
    expect(container.components).toHaveLength(1);
    expect(buttons(container)).toEqual([]);
  });

  test("notes: Note heading, no DM and no Delete DM", () => {
    const container = json(
      render({
        actionType: ActionType.Note,
        action: noteAction(),
        results: [
          Ok(
            makeCase({
              actionType: ActionType.Note,
              reason: "watch",
              dm: null,
            }),
          ),
        ],
        savePrompt: true,
      }),
    );
    expect(reasonText(container)).toBe(
      `**${emojis.reason} Note** · mods only\nwatch`,
    );
    expect(buttons(container).map((b) => b.label)).toEqual([
      "Edit note",
      "Add proof",
    ]);
  });

  test("timeout shows the duration under the header", () => {
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
    expect(textById(container, ACTION_RESPONSE_IDS.details)).toMatch(
      new RegExp(`^-# ${emojis.duration} 1d · ends <t:\\d+:f>$`),
    );
    expect(container.components[1].id).toBe(ACTION_RESPONSE_IDS.details);
  });

  test("reason notes go under the reason", () => {
    const container = json(
      render({
        reasonNotes: [
          templateNote({ id: "1", shortcut: "spam" }),
          unknownShortcutNote("x", emojis, true),
        ],
        guildConfig: withBanDmText("Appeal"),
      }),
    );
    expect(reasonText(container)).toBe(
      [
        `**${emojis.dm_sent} Reason** · sent to spambot by DM`,
        "Spamming invite links",
        "-# Template `!spam`",
        `-# ${unknownShortcutNote("x", emojis, true)}`,
        "-# Also included your server's ban message",
      ].join("\n"),
    );
  });

  test("save prompt adds the hint and a Save as template row at the end", () => {
    const container = json(render({ savePrompt: true }));
    expect(hasSavePrompt(posted(render({ savePrompt: true })))).toBe(true);
    expect(buttons(container).at(-1)?.label).toBe("Save as template");
    expect(hasSavePrompt(posted(render()))).toBe(false);
  });

  describe("proof", () => {
    test("without entries: a hint and the Add proof button", () => {
      const text = proofText(json(render()));
      expect(text).toBe(
        `**${emojis.lock} Proof** · mods only\n-# None yet. Add screenshots, message links or context for other mods.`,
      );
    });

    test("entries oldest first, media in a gallery, other files as raw links", () => {
      const container = json(
        render({
          proofs: [
            proof({
              attachments: [
                "https://cdn.discordapp.com/attachments/1/2/a.png?ex=1",
                "https://cdn.discordapp.com/attachments/1/2/log.txt",
              ],
            }),
            proof({
              id: "2",
              authorId: OTHER_MOD,
              content: null,
              sourceAuthorId: TARGET,
              sourceContent: "free nitro",
              sourceMessageUrl: MOD_LOG_URL,
            }),
          ],
        }),
      );

      expect(proofText(container)).toBe(
        [
          `**${emojis.lock} Proof** · mods only`,
          `-# <@${MOD}> · <t:1793098800:R> · 2 files`,
          "Reported in #reports",
          "https://cdn.discordapp.com/attachments/1/2/log.txt",
          `-# <@${OTHER_MOD}> · <t:1793098800:R> · message from <@${TARGET}>`,
          "> free nitro",
          MOD_LOG_URL,
        ].join("\n"),
      );
      const gallery = byId(container, ACTION_RESPONSE_IDS.media);
      expect(gallery).toMatchObject({
        items: [
          {
            media: {
              url: "https://cdn.discordapp.com/attachments/1/2/a.png?ex=1",
            },
          },
        ],
      });
    });

    test("the file uploaded with the response is referenced by name", () => {
      const container = json(
        render({
          upload: "proof_1.png",
          proofs: [
            proof({
              source: "action",
              content: null,
              attachments: ["https://cdn.discordapp.com/ephemeral/proof_1.png"],
            }),
          ],
        }),
      );
      expect(byId(container, ACTION_RESPONSE_IDS.media)).toMatchObject({
        items: [{ media: { url: "attachment://proof_1.png" } }],
      });
      expect(proofText(container)).not.toContain("None yet");
    });

    test("too spread out for buttons: plain proof text, no rows", () => {
      const targets = manyTargets(25);
      const results = targets.map((t, i) =>
        Ok(makeCase({ caseId: `${10000 + i * 3}`, userId: t.id })),
      );
      const container = json(render({ targets, results }));
      expect(buttons(container)).toEqual([]);
      expect(byId(container, ACTION_RESPONSE_IDS.proofSection)).toBeUndefined();
      expect(proofText(container)).toStartWith(`**${emojis.lock} Proof**`);
      expect(textById(container, ACTION_RESPONSE_IDS.footer)).toContain(
        "too spread out",
      );
      expectWithinLimits(container);
    });
  });

  test("25 targets, a 3,000 character reason and long proof fit in every mode", () => {
    const reason = "r".repeat(3000);
    const targets = manyTargets(25);
    const cases = targets.map((t, i) =>
      makeCase({
        caseId: `${10000 + i}`,
        userId: t.id,
        userTag: t.user.username,
        reason,
      }),
    );
    const proofs = Array.from({ length: 4 }, (_, i) =>
      proof({ id: `${i}`, content: `${i}`.repeat(1000) }),
    );
    const full = render({
      targets,
      results: cases.map((c) => Ok(c)),
      action: banAction(reason),
      guildConfig: withBanDmText("z".repeat(2000)),
      reasonNotes: [templateNote({ id: "1", shortcut: "spam" })],
      savePrompt: true,
      proofs,
    });
    const container = json(full);
    expect(reasonText(container)).toContain(`\n${reason}\n`);
    expect(proofText(container)).toContain("-# +4 more on the mod log entry");
    expect(headerText(container)).toContain("more");
    expectWithinLimits(container);

    const confirming = rebuild(full, {
      cases,
      proofs,
      savePrompt: true,
      mode: "confirmDeleteDm",
    });
    expect(buttons(json(confirming)).map((b) => b.label)).toContain("Cancel");
    expectWithinLimits(json(confirming));

    for (const mode of ["expired", "stale"] as const) {
      const rebuilt = rebuild(full, {
        cases,
        proofs,
        savePrompt: true,
        mode,
        modLogUrl: MOD_LOG_URL,
      });
      expectWithinLimits(json(rebuilt));
    }

    for (const from of [full, confirming]) {
      expectWithinLimits(json(must(expireActionResponse(posted(from)))));
      expectWithinLimits(
        json(must(staleActionResponse(posted(from), MOD_LOG_URL))),
      );
    }
  });

  test("a single target shows proof until the budget, then points at the mod log", () => {
    const reason = "r".repeat(3000);
    const proofs = Array.from({ length: 6 }, (_, i) =>
      proof({ id: `${i}`, content: `${i}`.repeat(100) }),
    );
    const container = json(
      render({
        results: [Ok(makeCase({ reason }))],
        action: banAction(reason),
        proofs,
      }),
    );
    const text = proofText(container);
    expect(text).toContain("0".repeat(100));
    expect(text).not.toContain("5".repeat(100));
    expect(text).toContain("-# +");
    expectWithinLimits(container);

    const linked = rebuild(
      render({ results: [Ok(makeCase({ reason }))], proofs }),
      {
        cases: [makeCase({ reason })],
        proofs,
        modLogUrl: MOD_LOG_URL,
      },
    );
    expect(proofText(json(linked))).toContain(
      `more on the mod log entry: ${MOD_LOG_URL}`,
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
      emojis: {
        ...emojis,
        message_edit: "",
        trash: "",
        save: "",
        attachment: "",
        lock: "",
        dm_sent: "",
      },
      savePrompt: true,
      now: NOW,
    }).components[0].toJSON();

    expect(buttons(container)).toHaveLength(4);
    expect(
      buttons(container).every((b) => b.emoji === undefined || b.emoji.id),
    ).toBe(true);
    expect(reasonText(container)).toStartWith("**Reason** · sent to");
  });

  test("no variant contains a native emoji, and all serialize", () => {
    const variants = [
      render(),
      render({
        savePrompt: true,
        reasonNotes: [unknownShortcutNote("x", emojis, true)],
        guildConfig: withBanDmText("Appeal"),
        proofs: [proof()],
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
  test("confirm mode swaps the reason row for the confirm in place", () => {
    const original = render({ savePrompt: true });
    const confirmingMessage = rebuild(original, {
      cases: [makeCase()],
      savePrompt: true,
      mode: "confirmDeleteDm",
    });
    const confirming = json(confirmingMessage);
    expect(topLevelTypes(confirming).slice(0, 5)).toEqual([
      ACTION_RESPONSE_IDS.header,
      ComponentType.Separator,
      ACTION_RESPONSE_IDS.reason,
      ACTION_RESPONSE_IDS.confirm,
      ACTION_RESPONSE_IDS.reasonRow,
    ]);
    expect(buttons(confirming).map((b) => b.label)).toEqual([
      "Delete DM",
      "Cancel",
      "Add proof",
      "Save as template",
    ]);

    const cancelled = json(
      rebuild(confirmingMessage, {
        cases: [makeCase()],
        savePrompt: true,
      }),
    );
    expect(cancelled).toEqual(json(original));
  });

  test("keeps the single-target header and its thumbnail", () => {
    const original = render();
    const rebuilt = json(rebuild(original, { cases: [makeCase()] }));
    expect(byId(rebuilt, ACTION_RESPONSE_IDS.header)).toEqual(
      byId(json(original), ACTION_RESPONSE_IDS.header),
    );
  });

  test("notes stay while the reason is unchanged, and status lines aren't taken for notes", () => {
    const original = render({
      reasonNotes: [templateNote({ id: "1", shortcut: "spam" })],
      guildConfig: withBanDmText("Appeal"),
    });
    const deleted = json(
      rebuild(original, {
        cases: [makeCase({ dmDeleted: true })],
        dmSuffix: " · mod log updated",
      }),
    );
    expect(reasonText(deleted)).toBe(
      [
        `**${emojis.reason} Reason** · not sent`,
        "Spamming invite links",
        "-# Template `!spam`",
        `-# DM deleted by <@${OTHER_MOD}> <t:1793099100:R> · mod log updated`,
      ].join("\n"),
    );

    const again = json(
      rebuildActionResponse(
        [deleted as unknown as APIMessageTopLevelComponent],
        {
          cases: [makeCase({ dmDeleted: true })],
          proofs: [],
          emojis,
          savePrompt: false,
          mode: "buttons",
        },
      ),
    );
    expect(reasonText(again)).toBe(
      [
        `**${emojis.reason} Reason** · not sent`,
        "Spamming invite links",
        "-# Template `!spam`",
        `-# DM deleted by <@${OTHER_MOD}> <t:1793099100:R>`,
      ].join("\n"),
    );
  });

  test("the 'also included' line survives rebuilds without the guild config", () => {
    const original = render({ guildConfig: withBanDmText("Appeal") });
    const rebuilt = json(rebuild(original, { cases: [makeCase()] }));
    expect(reasonText(rebuilt)).toBe(reasonText(json(original)));
  });

  test("each DM state round-trips without doubling its line", () => {
    const states = [
      makeCase(),
      makeCase({ dm: null }),
      makeCase({ dm: null, dmIntentSource: "executor_no" }),
      makeCase({ dm: { error: "x", failureReason: "user_privacy" } }),
      makeCase({ dmDeleted: true }),
    ];
    for (const moderationCase of states) {
      const original = render({
        results: [Ok(moderationCase)],
        reasonNotes: ["Template `!spam`"],
        guildConfig: withBanDmText("Appeal"),
      });
      const rebuilt = json(rebuild(original, { cases: [moderationCase] }));
      expect(reasonText(rebuilt)).toBe(reasonText(json(original)));
    }
  });

  test("a reason ending in small-text lines is compared whole", () => {
    const reason = "Spam\n-# DM failed: not a real status\n-# 3 deleted";
    const moderationCase = makeCase({ reason });
    const original = render({
      results: [Ok(moderationCase)],
      action: banAction(reason),
      reasonNotes: ["Template `!spam`"],
    });
    const rebuilt = json(rebuild(original, { cases: [moderationCase] }));
    expect(reasonText(rebuilt)).toBe(reasonText(json(original)));
  });

  test("a DM outcome line goes away on the next rebuild", () => {
    const original = render();
    const edited = rebuild(original, {
      cases: [
        makeCase({ reason: "New reason", reasonSetBy: MOD, reasonSetAt: NOW }),
      ],
      reasonNotes: [editedNote(MOD, NOW)],
      dmOverride: `${emojis.message} DM updated with the new reason`,
    });
    expect(reasonText(json(edited))).toContain(
      `-# ${emojis.message} DM updated with the new reason`,
    );

    const later = json(
      rebuild(edited, {
        cases: [
          makeCase({
            reason: "New reason",
            reasonSetBy: MOD,
            reasonSetAt: NOW,
          }),
        ],
        mode: "confirmDeleteDm",
      }),
    );
    expect(reasonText(later)).toBe(
      [
        `**${emojis.dm_sent} Reason** · sent to spambot by DM`,
        "New reason",
        `-# ${editedNote(MOD, NOW)}`,
      ].join("\n"),
    );
  });

  test("a reason changed elsewhere drops the old notes for Edited by", () => {
    const original = render({ reasonNotes: ["Template `!spam`"] });
    const rebuilt = json(
      rebuild(original, {
        cases: [
          makeCase({
            reason: "Changed",
            reasonSetBy: OTHER_MOD,
            reasonSetAt: NOW,
          }),
        ],
      }),
    );
    expect(reasonText(rebuilt)).toContain(
      `Changed\n-# ${editedNote(OTHER_MOD, NOW)}`,
    );
    expect(reasonText(rebuilt)).not.toContain("Template");
  });

  test("a short reason edited to 3,000 characters shrinks the posted header", () => {
    const targets = manyTargets(25);
    const cases = targets.map((t, i) =>
      makeCase({
        caseId: `${10000 + i}`,
        userId: t.id,
        userTag: t.user.username,
      }),
    );
    const original = render({ targets, results: cases.map((c) => Ok(c)) });
    const reason = "r".repeat(3000);
    const edited = cases.map((c) =>
      makeCase({
        caseId: c.caseId,
        userId: c.userId,
        userTag: c.userTag,
        reason,
      }),
    );
    const rebuilt = json(
      rebuild(original, {
        cases: edited,
        proofs: [proof({ content: "p".repeat(1000) })],
        reasonNotes: [editedNote(MOD, NOW)],
      }),
    );
    expect(reasonText(rebuilt)).toContain(`\n${reason}\n`);
    expect(headerText(rebuilt)).toStartWith(
      must(headerText(json(original)).split("\n")[0]),
    );
    expect(headerText(rebuilt)).toContain("-# …and more");
    expectWithinLimits(rebuilt);
    expectWithinLimits(
      json(
        must(
          staleActionResponse(
            posted(render({ targets, results: cases.map((c) => Ok(c)) })),
            MOD_LOG_URL,
          ),
        ),
      ),
    );
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
            type: ComponentType.Section,
            id: ACTION_RESPONSE_IDS.reasonSection,
            components: [
              {
                type: ComponentType.TextDisplay,
                id: ACTION_RESPONSE_IDS.reason,
                content: "**Reason**\nSpamming invite links",
              },
              {
                type: ComponentType.TextDisplay,
                id: ACTION_RESPONSE_IDS.reasonNotes,
                content: "-# Template `!spam`",
              },
            ],
            accessory: {
              type: ComponentType.Button,
              style: 2,
              label: "Edit reason",
              custom_id: "modAction/reason/edit/4822",
            },
          },
          { type: ComponentType.Separator, id: 2 },
          {
            type: ComponentType.TextDisplay,
            id: ACTION_RESPONSE_IDS.dm,
            content:
              "**DM sent** · what they received:\n> Spamming invite links\n> Appeal here",
          },
        ],
      } as APIMessageTopLevelComponent,
    ];

    const rebuilt = json(
      rebuildActionResponse(old, {
        cases: [makeCase()],
        proofs: [],
        emojis,
        savePrompt: false,
        mode: "buttons",
      }),
    );
    expect(reasonText(rebuilt)).toBe(
      [
        `**${emojis.dm_sent} Reason** · sent to spambot by DM`,
        "Spamming invite links",
        "-# Template `!spam`",
        "-# Also included your server's ban message",
      ].join("\n"),
    );
    expect(textById(rebuilt, ACTION_RESPONSE_IDS.dm)).toBeNull();
    expect(buttons(rebuilt).map((b) => b.label)).toEqual([
      "Edit reason",
      "Delete DM",
      "Add proof",
    ]);
    expectWithinLimits(rebuilt);
  });
});

describe("expiry and staleness", () => {
  test("expiry disables selects too, keeping their options", () => {
    const original: APIMessageTopLevelComponent[] = [
      {
        type: ComponentType.Container,
        components: [
          {
            type: ComponentType.ActionRow,
            id: 7,
            components: [
              {
                type: ComponentType.StringSelect,
                id: 8,
                custom_id: "modAction/example",
                options: [{ label: "One", value: "1" }],
              },
            ],
          },
        ],
      } as APIMessageTopLevelComponent,
    ];
    const expired = json(must(expireActionResponse(original)));
    expect(expired.components[0]).toEqual({
      type: ComponentType.ActionRow,
      id: 7,
      components: [
        {
          type: ComponentType.StringSelect,
          id: 8,
          custom_id: "modAction/example",
          options: [{ label: "One", value: "1" }],
          disabled: true,
        },
      ],
    });
  });

  function disabledFlags(container: APIContainerComponent): boolean[] {
    return buttons(container).map((b) => b.disabled === true);
  }

  test("window is 15 minutes", () => {
    const created = Date.parse("2026-10-27T11:00:00.000Z");
    expect(isResponseExpired(created, created + 14 * 60 * 1000)).toBe(false);
    expect(isResponseExpired(created, created + 15 * 60 * 1000)).toBe(true);
  });

  test("expiry keeps every button, disabled, plus the expired line, once", () => {
    const original = posted(render({ savePrompt: true, proofs: [proof()] }));
    const expired = json(must(expireActionResponse(original)));

    expect(buttons(expired).map((b) => b.label)).toEqual([
      "Edit reason",
      "Delete DM",
      "Add proof",
      "Save as template",
    ]);
    expect(disabledFlags(expired).every(Boolean)).toBe(true);
    expect(lastText(expired)).toBe(EXPIRED_LINE);
    expect(showsExpiredLine(posted(expireMessage(original)))).toBe(true);
    expect(expireActionResponse(posted(expireMessage(original)))).toBeNull();
    expect(showsExpiredLine(original)).toBe(false);
  });

  test("the expired rebuild matches the timer's render", () => {
    const original = render({ savePrompt: true, proofs: [proof()] });
    const timer = json(must(expireActionResponse(posted(original))));
    const rebuilt = json(
      rebuild(original, {
        cases: [makeCase()],
        proofs: [proof()],
        savePrompt: true,
        mode: "expired",
      }),
    );
    expect(rebuilt).toEqual(timer);
  });

  test("expiry drops Discord's extra media fields", () => {
    const original = posted(
      render({
        proofs: [
          proof({
            attachments: [
              "https://cdn.discordapp.com/attachments/1/2/a.png?ex=1",
            ],
          }),
        ],
      }),
    );
    const container = original[0] as APIContainerComponent;
    const gallery = container.components.find(
      (c) => c.id === ACTION_RESPONSE_IDS.media,
    ) as unknown as { items: { media: Record<string, unknown> }[] };
    gallery.items[0].media.proxy_url = "https://media.discordapp.net/x";
    gallery.items[0].media.width = 10;

    const expired = json(must(expireActionResponse(original)));
    expect(byId(expired, ACTION_RESPONSE_IDS.media)).toEqual({
      type: ComponentType.MediaGallery,
      id: ACTION_RESPONSE_IDS.media,
      items: [
        {
          media: {
            url: "https://cdn.discordapp.com/attachments/1/2/a.png?ex=1",
          },
        },
      ],
    });
  });

  test("stale keeps buttons disabled and links the mod log entry", () => {
    const original = posted(render());
    const stale = json(must(staleActionResponse(original, MOD_LOG_URL)));
    expect(disabledFlags(stale).every(Boolean)).toBe(true);
    expect(lastText(stale)).toBe(
      `-# Changed in the mod log after this was posted. Up-to-date entry: ${MOD_LOG_URL}`,
    );
    expect(postedStaleUrl(posted(staleMessage(original, MOD_LOG_URL)))).toBe(
      MOD_LOG_URL,
    );
    expect(showsExpiredLine(posted(staleMessage(original, MOD_LOG_URL)))).toBe(
      true,
    );
    expect(
      staleActionResponse(posted(staleMessage(original, MOD_LOG_URL)), null),
    ).toBeNull();
    expect(
      expireActionResponse(posted(staleMessage(original, MOD_LOG_URL))),
    ).toBeNull();
  });

  test("stale without a known entry says the entry is up to date", () => {
    expect(staleLine(null)).toBe(
      "-# Changed in the mod log after this was posted. The mod log entry is up to date.",
    );
    const stale = staleMessage(posted(render()), null);
    expect(postedStaleUrl(posted(stale))).toBeNull();
    expect(postedStaleUrl(posted(render()))).toBeUndefined();
  });

  test("an old response with the expired line in the footer counts as expired", () => {
    const old: APIMessageTopLevelComponent[] = [
      {
        type: ComponentType.Container,
        components: [
          {
            type: ComponentType.TextDisplay,
            id: ACTION_RESPONSE_IDS.footer,
            content: EXPIRED_LINE,
          },
        ],
      } as APIMessageTopLevelComponent,
    ];
    expect(showsExpiredLine(old)).toBe(true);
  });

  test("a response without buttons never gets the terminal line", () => {
    const failed = posted(render({ results: [Err("nope")] }));
    expect(expireActionResponse(failed)).toBeNull();
    expect(staleActionResponse(failed, null)).toBeNull();
  });
});

describe("postedResponseDiffers", () => {
  function differs(
    from: ActionResponseMessage | APIMessageTopLevelComponent[],
    cases: ModerationCase[],
    proofs: CaseProof[] = [],
  ): boolean {
    const components = Array.isArray(from) ? from : posted(from);
    return postedResponseDiffers(components, { cases, proofs, emojis });
  }

  test("a response matches the cases it was rendered from", () => {
    expect(
      differs(render({ proofs: [proof()] }), [makeCase()], [proof()]),
    ).toBe(false);
  });

  test("the proof text id carries the entry count", () => {
    const container = json(render({ proofs: [proof(), proof({ id: "2" })] }));
    expect(proofTextComponent(container)?.id).toBe(PROOF_TEXT_ID_BASE + 2);
  });

  test("a reason changed elsewhere differs", () => {
    expect(
      differs(render(), [
        makeCase({
          reason: "Changed",
          reasonSetBy: OTHER_MOD,
          reasonSetAt: NOW,
        }),
      ]),
    ).toBe(true);
  });

  test("a rebuilt response after its own edit matches", () => {
    const edited = makeCase({
      reason: "Changed",
      reasonSetBy: MOD,
      reasonSetAt: NOW,
    });
    const rebuilt = rebuild(render(), {
      cases: [edited],
      reasonNotes: [editedNote(MOD, NOW)],
      dmOverride: `${emojis.message} DM updated with the new reason`,
    });
    expect(differs(rebuilt, [edited])).toBe(false);
  });

  test("a response posted with older DM status wording still matches", () => {
    const moderationCase = makeCase({
      dm: null,
      dmIntentSource: "executor_no",
    });
    const current = posted(
      render({
        results: [Ok(moderationCase)],
        reasonNotes: ["Template `!spam`"],
      }),
    );
    const older = JSON.parse(
      JSON.stringify(current).replace(
        "DM not sent: the mod chose no DM",
        "DM not sent: you chose no DM",
      ),
    ) as APIMessageTopLevelComponent[];
    expect(JSON.stringify(older)).toContain("you chose no DM");

    expect(differs(older, [moderationCase])).toBe(false);
    const rebuilt = reasonText(
      json(
        rebuildActionResponse(older, {
          cases: [moderationCase],
          proofs: [],
          emojis,
          savePrompt: false,
          mode: "buttons",
        }),
      ),
    );
    expect(rebuilt).toContain("-# Template `!spam`");
    expect(rebuilt).toContain("-# DM not sent: the mod chose no DM");
    expect(rebuilt).not.toContain("you chose no DM");
  });

  test("proof added elsewhere differs, edited content doesn't", () => {
    const original = render({ proofs: [proof()] });
    expect(differs(original, [makeCase()], [proof(), proof({ id: "2" })])).toBe(
      true,
    );
    expect(
      differs(original, [makeCase()], [proof({ content: "reworded" })]),
    ).toBe(false);
  });

  test("entries collapsed into '+N more' still count as shown", () => {
    const reason = "r".repeat(3000);
    const proofs = Array.from({ length: 6 }, (_, i) =>
      proof({ id: `${i}`, content: `${i}`.repeat(100) }),
    );
    const original = render({
      results: [Ok(makeCase({ reason }))],
      action: banAction(reason),
      proofs,
    });
    expect(proofText(json(original))).toContain("-# +");
    expect(differs(original, [makeCase({ reason })], proofs)).toBe(false);
  });

  test("a DM deleted elsewhere differs, one deleted here doesn't", () => {
    const original = render();
    expect(differs(original, [makeCase({ dmDeleted: true })])).toBe(true);

    const deletedHere = rebuild(original, {
      cases: [makeCase({ dmDeleted: true })],
    });
    expect(differs(deletedHere, [makeCase({ dmDeleted: true })])).toBe(false);
  });

  test("one of several DMs deleted elsewhere differs", () => {
    const targets = [makeTarget(TARGET, "a"), makeTarget(TARGET_2, "b")];
    const cases = targets.map((t, i) =>
      makeCase({ caseId: `${4822 + i}`, userId: t.id }),
    );
    const original = render({ targets, results: cases.map((c) => Ok(c)) });
    expect(differs(original, cases)).toBe(false);
    expect(
      differs(original, [
        cases[0],
        makeCase({ caseId: "4823", userId: TARGET_2, dmDeleted: true }),
      ]),
    ).toBe(true);
  });

  test("the Delete DM confirm counts as a live DM", () => {
    const confirming = rebuild(render(), {
      cases: [makeCase()],
      mode: "confirmDeleteDm",
    });
    expect(differs(confirming, [makeCase()])).toBe(false);
    expect(differs(confirming, [makeCase({ dmDeleted: true })])).toBe(true);
  });

  test("action-time proof is never counted, saved later or not at all", () => {
    const action = proof({ source: "action", content: null });
    const posted = render({ upload: "proof_1.png" });
    expect(differs(posted, [makeCase()], [action])).toBe(false);

    const withPlaceholder = render({ upload: "proof_1.png", proofs: [action] });
    expect(differs(withPlaceholder, [makeCase()], [])).toBe(false);
    expect(differs(withPlaceholder, [makeCase()], [action, proof()])).toBe(
      true,
    );
  });

  test("the Delete DM button id carries the live count, also while confirming", () => {
    const targets = [makeTarget(TARGET, "a"), makeTarget(TARGET_2, "b")];
    const cases = targets.map((t, i) =>
      makeCase({ caseId: `${4822 + i}`, userId: t.id }),
    );
    const original = render({ targets, results: cases.map((c) => Ok(c)) });
    expect(
      buttons(json(original)).find((b) => b.label === "Delete 2 DMs")?.id,
    ).toBe(LIVE_DM_BUTTON_ID_BASE + 2);

    const confirming = rebuild(original, { cases, mode: "confirmDeleteDm" });
    expect(buttons(json(confirming))[0].id).toBe(LIVE_DM_BUTTON_ID_BASE + 2);
    expect(differs(confirming, cases)).toBe(false);
    expect(
      differs(confirming, [
        cases[0],
        makeCase({ caseId: "4823", userId: TARGET_2, dmDeleted: true }),
      ]),
    ).toBe(true);
  });

  test("every case's reason is compared, not just the first", () => {
    const targets = [makeTarget(TARGET, "a"), makeTarget(TARGET_2, "b")];
    const cases = targets.map((t, i) =>
      makeCase({ caseId: `${4822 + i}`, userId: t.id }),
    );
    const original = render({ targets, results: cases.map((c) => Ok(c)) });
    expect(
      differs(original, [
        cases[0],
        makeCase({ caseId: "4823", userId: TARGET_2, reason: "Changed" }),
      ]),
    ).toBe(true);
  });

  test("trailing spaces and CRLF line ends don't read as a change", () => {
    const reason = "Spam  \r\nmore text ";
    const original = posted(
      render({
        results: [Ok(makeCase({ reason }))],
        action: banAction(reason),
      }),
    );
    const container = original[0] as APIContainerComponent;
    const shown = container.components.find(
      (c) => c.id === ACTION_RESPONSE_IDS.reason,
    ) as { content: string };
    shown.content = shown.content
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((l) => l.trimEnd())
      .join("\n");
    expect(differs(original, [makeCase({ reason })])).toBe(false);
  });

  test("component ids stay unique with 102 proofs and 2 live DMs", () => {
    const targets = [makeTarget(TARGET, "a"), makeTarget(TARGET_2, "b")];
    const cases = targets.map((t, i) =>
      makeCase({ caseId: `${4822 + i}`, userId: t.id }),
    );
    const proofs = Array.from({ length: 102 }, (_, i) =>
      proof({ id: `${i}`, content: "x" }),
    );
    for (const mode of ["buttons", "confirmDeleteDm"] as const) {
      const message = rebuild(
        render({ targets, results: cases.map((c) => Ok(c)), proofs }),
        { cases, proofs, mode },
      );
      const ids: number[] = [];
      const visit = (node: unknown) => {
        const c = node as {
          id?: number;
          components?: unknown[];
          accessory?: unknown;
        };
        if (c.id !== undefined) {
          ids.push(c.id);
        }
        (c.components ?? []).forEach(visit);
        if (c.accessory) {
          visit(c.accessory);
        }
      };
      json(message).components.forEach(visit);
      expect(ids).toContain(PROOF_TEXT_ID_BASE + 102);
      expect(ids).toContain(LIVE_DM_BUTTON_ID_BASE + 2);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test("a reason ending in a newline doesn't read as a change", () => {
    const reason = "Spam\n";
    const original = posted(
      render({
        results: [Ok(makeCase({ reason }))],
        action: banAction(reason),
        reasonNotes: ["Template `!spam`"],
      }),
    );
    expect(differs(original, [makeCase({ reason })])).toBe(false);
    expect(differs(original, [makeCase({ reason: "Spam" })])).toBe(false);
  });

  test("only Delete DM buttons are read for the live DM count", () => {
    const withButton = (button: Record<string, unknown>) =>
      [
        {
          type: ComponentType.Container,
          components: [
            {
              type: ComponentType.TextDisplay,
              id: ACTION_RESPONSE_IDS.reason,
              content: "**Reason**\nSpamming invite links",
            },
            {
              type: ComponentType.ActionRow,
              components: [{ type: ComponentType.Button, style: 2, ...button }],
            },
          ],
        },
      ] as unknown as APIMessageTopLevelComponent[];

    const save = withButton({
      label: "Save as template",
      custom_id: "modAction/save/4822",
      id: LIVE_DM_BUTTON_ID_BASE + 2,
    });
    expect(differs(save, [makeCase({ dmDeleted: true })])).toBe(false);

    const oldConfirm = withButton({
      label: "Delete DM",
      custom_id: "modAction/dm/deleteConfirm/4822",
    });
    expect(differs(oldConfirm, [makeCase()])).toBe(false);
    expect(differs(oldConfirm, [makeCase({ dmDeleted: true })])).toBe(true);
  });

  test("an old response without a proof section skips the proof comparison", () => {
    const old: APIMessageTopLevelComponent[] = [
      {
        type: ComponentType.Container,
        components: [
          {
            type: ComponentType.TextDisplay,
            id: ACTION_RESPONSE_IDS.reason,
            content: "**Reason**\nSpamming invite…",
          },
          {
            type: ComponentType.Section,
            id: ACTION_RESPONSE_IDS.dmSection,
            components: [
              {
                type: ComponentType.TextDisplay,
                id: ACTION_RESPONSE_IDS.dm,
                content: "**DM sent**",
              },
            ],
            accessory: {
              type: ComponentType.Button,
              style: 2,
              label: "Delete DM",
              custom_id: "modAction/dm/delete/4822",
            },
          },
        ],
      } as APIMessageTopLevelComponent,
    ];
    expect(differs(old, [makeCase()], [proof({ source: "backfill" })])).toBe(
      false,
    );
    expect(differs(old, [makeCase({ reason: "Other" })])).toBe(true);
    expect(differs(old, [makeCase({ dmDeleted: true })])).toBe(true);
  });
});

describe("byline", () => {
  test("uses the executor's username", () => {
    expect(headerText(json(render()))).toContain(`by <@${MOD}> (tzuyu)`);
  });
});

function lastText(container: APIContainerComponent): string | null {
  const last = container.components.at(-1);
  return last?.type === ComponentType.TextDisplay ? last.content : null;
}

function expireMessage(
  original: APIMessageTopLevelComponent[],
): ActionResponseMessage {
  return must(expireActionResponse(original));
}

function staleMessage(
  original: APIMessageTopLevelComponent[],
  url: string | null,
): ActionResponseMessage {
  return must(staleActionResponse(original, url));
}
