import { describe, expect, test } from "bun:test";
import { ComponentType, MessageFlags } from "discord.js";

import type { EmojiMap } from "@/features/bot-emojis";
import { HISTORY_ACTION_EMOJIS } from "@/features/moderation/cases/presentation/views/HistoryView";
import type { CaseProof } from "@/features/moderation/shared/domain/entities/CaseProof";
import { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { Reason } from "@/features/moderation/shared/domain/value-objects/Reason";
import { buildAddProofCustomId } from "@/features/moderation/shared/presentation/proof/customIds";

import { MODVIEW_CUSTOM_IDS } from "../customIds";
import {
  CASE_VIEW_TEXT_MAX,
  buildCaseSelect,
  buildCaseViewMessages,
} from "./CaseView";

const GUILD_ID = "111111111111111111";
const USER_ID = "222222222222222222";
const MOD_ID = "444444444444444444";
const NOW = new Date("2026-11-03T12:00:00Z");

const emojis = Object.fromEntries(
  HISTORY_ACTION_EMOJIS.map((name) => [name, `:${name}:`]),
) as EmojiMap<typeof HISTORY_ACTION_EMOJIS>;

const realEmojis = Object.fromEntries(
  HISTORY_ACTION_EMOJIS.map((name, i) => [
    name,
    `<:${name}:${1234567890123456700n + BigInt(i)}>`,
  ]),
) as EmojiMap<typeof HISTORY_ACTION_EMOJIS>;

function makeCase(
  caseId: string,
  opts: {
    actionType?: ActionType;
    reason?: string | null;
    actionTime?: Date;
  } = {},
): ModerationCase {
  return new ModerationCase(
    GUILD_ID,
    caseId,
    opts.actionType ?? ActionType.Ban,
    opts.actionTime ?? new Date(NOW.getTime() - 2 * 3600_000),
    USER_ID,
    "spambot",
    MOD_ID,
    Reason.create(opts.reason ?? null).unwrap(),
  );
}

function makeProof(overrides: Partial<CaseProof> = {}): CaseProof {
  return {
    id: "1",
    guildId: GUILD_ID,
    caseId: "7",
    authorId: MOD_ID,
    createdAt: new Date(NOW.getTime() - 300_000),
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

type Json = Record<string, unknown> & { components?: Json[]; accessory?: Json };

function json(message: { components: readonly { toJSON(): unknown }[] }): Json {
  return message.components[0].toJSON() as Json;
}

function texts(node: Json): string[] {
  const out: string[] = [];
  if (node.type === ComponentType.TextDisplay) {
    out.push(node.content as string);
  }
  for (const child of node.components ?? []) {
    out.push(...texts(child));
  }
  return out;
}

describe("buildCaseSelect", () => {
  test("one option per case with age, reason start and action emoji", () => {
    const row = buildCaseSelect(
      [
        makeCase("4822", { reason: "Spamming  invite\nlinks" }),
        makeCase("4790", {
          actionType: ActionType.Note,
          reason: "x".repeat(300),
          actionTime: new Date(NOW.getTime() - 10 * 86400_000),
        }),
        makeCase("4801", { actionType: ActionType.Warn }),
      ],
      realEmojis,
      false,
      NOW,
    )?.toJSON();

    const select = row?.components[0];
    expect(select).toMatchObject({
      type: ComponentType.StringSelect,
      custom_id: MODVIEW_CUSTOM_IDS.historyCase,
      placeholder: "View case…",
      disabled: false,
    });
    const options =
      select?.type === ComponentType.StringSelect ? select.options : [];

    expect(options[0]).toMatchObject({
      value: "4822",
      label: "#4822 Ban · 2 hours ago",
      description: "Spamming invite links",
      emoji: {
        name: "ban",
        id: String(
          1234567890123456700n + BigInt(HISTORY_ACTION_EMOJIS.indexOf("ban")),
        ),
      },
    });
    expect(options[1].label).toBe("#4790 Note · 10 days ago");
    expect(options[1].description).toHaveLength(100);
    expect(options[2].description).toBeUndefined();
  });

  test("absent for an empty page and skips missing emojis", () => {
    expect(buildCaseSelect([], emojis, false)).toBeNull();

    const blank = Object.fromEntries(
      HISTORY_ACTION_EMOJIS.map((name) => [name, ""]),
    ) as EmojiMap<typeof HISTORY_ACTION_EMOJIS>;
    const row = buildCaseSelect([makeCase("1")], blank, true, NOW)?.toJSON();
    const select = row?.components[0];
    const options =
      select?.type === ComponentType.StringSelect ? select.options : [];
    expect(options[0].emoji).toBeUndefined();
    expect(select?.disabled).toBe(true);
  });
});

describe("buildCaseViewMessages", () => {
  test("header, reason, then proof with Add proof, gallery and raw links", () => {
    const moderationCase = makeCase("7", {
      reason: "Spamming invite links",
    }).withDMResult({ channelId: "1", messageId: "2" });
    const proofs = [
      makeProof({
        attachments: [
          "https://cdn.discordapp.com/attachments/1/2/shot.png",
          "https://cdn.discordapp.com/attachments/1/3/log.txt",
        ],
      }),
      makeProof({
        id: "2",
        content: null,
        sourceAuthorId: USER_ID,
        sourceContent: "free nitro",
        sourceMessageUrl: "https://discord.com/channels/1/2/3",
      }),
    ];

    const messages = buildCaseViewMessages(moderationCase, proofs, emojis, {
      serverDmTextIncluded: true,
    });

    expect(messages).toHaveLength(1);
    const [message] = messages;
    expect(message.flags & MessageFlags.Ephemeral).toBeTruthy();
    expect(message.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(message.allowedMentions).toEqual({ parse: [] });

    const container = json(message);
    expect(container.components?.map((c) => c.type)).toEqual([
      ComponentType.TextDisplay,
      ComponentType.Separator,
      ComponentType.TextDisplay,
      ComponentType.Separator,
      ComponentType.Section,
      ComponentType.MediaGallery,
      ComponentType.TextDisplay,
    ]);

    const [header, reason, proofText, links] = texts(container);
    expect(header).toBe(
      `### :ban: Ban · Case #7\n<@${USER_ID}> · by <@${MOD_ID}> · <t:${Math.floor(moderationCase.actionTime.getTime() / 1000)}:R>`,
    );
    expect(reason).toBe(
      "**:additional_message: Reason** · sent to user by DM\nSpamming invite links\n-# Also included your server's ban message",
    );
    expect(proofText).toStartWith("**:lock: Proof** · mods only\n-# <@");
    expect(proofText).toContain("Reported in #reports");
    expect(proofText).toContain(
      "> free nitro\nhttps://discord.com/channels/1/2/3",
    );
    expect(links).toBe("https://cdn.discordapp.com/attachments/1/3/log.txt");

    const section = container.components?.[4];
    expect(section?.accessory).toMatchObject({
      type: ComponentType.Button,
      custom_id: buildAddProofCustomId(["7"]),
      label: "Add proof",
    });
    const buttons = JSON.stringify(container).match(/"custom_id"/g) ?? [];
    expect(buttons).toHaveLength(1);
  });

  test("not-sent reason, no proof yet", () => {
    const moderationCase = makeCase("7", {
      actionType: ActionType.Kick,
      reason: "Ignoring mods",
    }).withDMIntent(false, "guild_default");

    const [message] = buildCaseViewMessages(moderationCase, [], emojis, {
      serverDmTextIncluded: true,
    });
    const [, reason, proofText] = texts(json(message));

    expect(reason).toBe(
      "**:reason: Reason** · not sent (kick DMs are off)\nIgnoring mods",
    );
    expect(proofText).toContain("None yet");
  });

  test("a note is mods-only, not an unsent reason", () => {
    const [message] = buildCaseViewMessages(
      makeCase("7", { actionType: ActionType.Note, reason: "Possible alt" }),
      [],
      emojis,
      { serverDmTextIncluded: false },
    );

    expect(texts(json(message))[1]).toBe(
      "**:lock: Note** · mods only\nPossible alt",
    );
  });

  test("moves proof past the 4000-char cap into follow-ups, never cutting it", () => {
    const moderationCase = makeCase("7", { reason: "r".repeat(3000) });
    const proofs = Array.from({ length: 6 }, (_, i) =>
      makeProof({ id: `${i}`, content: `${i}`.repeat(1000) }),
    );

    const messages = buildCaseViewMessages(moderationCase, proofs, realEmojis, {
      serverDmTextIncluded: false,
    });

    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) {
      const total = texts(json(message)).join("").length;
      expect(total).toBeLessThanOrEqual(CASE_VIEW_TEXT_MAX);
      expect(message.flags & MessageFlags.Ephemeral).toBeTruthy();
    }

    const all = messages.flatMap((m) => texts(json(m))).join("\n");
    for (let i = 0; i < 6; i++) {
      expect(all).toContain(`${i}`.repeat(1000));
    }
    expect(all).toContain("r".repeat(3000));
    expect(texts(json(messages[1]))[0]).toStartWith("**<:lock:");
    expect(texts(json(messages[1]))[0]).toContain("More proof · Case #7**");

    // Only the first message carries the Add proof button.
    for (const message of messages.slice(1)) {
      expect(JSON.stringify(json(message))).not.toContain("custom_id");
    }
  });

  test("raw file links follow spilled proof", () => {
    const moderationCase = makeCase("7", { reason: "r".repeat(3000) });
    const proofs = [
      makeProof({ content: "a".repeat(1000) }),
      makeProof({
        id: "2",
        content: null,
        attachments: ["https://cdn.discordapp.com/attachments/1/3/log.txt"],
      }),
    ];

    const messages = buildCaseViewMessages(moderationCase, proofs, emojis, {
      serverDmTextIncluded: false,
    });

    const last = texts(json(messages.at(-1) as (typeof messages)[number]));
    expect(last.join("\n")).toContain(
      "https://cdn.discordapp.com/attachments/1/3/log.txt",
    );
    expect(texts(json(messages[0])).join("\n")).not.toContain("log.txt");
  });
});
