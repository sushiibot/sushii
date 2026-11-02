import { describe, expect, test } from "bun:test";
import { ComponentType, MessageFlags } from "discord.js";

import type { EmojiMap } from "@/features/bot-emojis";
import { HISTORY_ACTION_EMOJIS } from "@/features/moderation/cases/presentation/views/HistoryView";
import { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { Reason } from "@/features/moderation/shared/domain/value-objects/Reason";

import { MODVIEW_CUSTOM_IDS } from "../customIds";
import {
  buildAttachmentSelect,
  buildCaseAttachmentsMessage,
} from "./CaseAttachmentsView";

const emojis = Object.fromEntries(
  HISTORY_ACTION_EMOJIS.map((name) => [name, `:${name}:`]),
) as EmojiMap<typeof HISTORY_ACTION_EMOJIS>;

function makeCase(
  caseId: string,
  attachments: string[],
  reason: string | null = null,
): ModerationCase {
  return ModerationCase.create(
    "111111111111111111",
    caseId,
    ActionType.Ban,
    "222222222222222222",
    "TestUser#0001",
    "444444444444444444",
    Reason.create(reason).unwrap(),
    undefined,
    attachments,
  );
}

describe("buildAttachmentSelect", () => {
  test("lists only the page's cases with attachments", () => {
    const row = buildAttachmentSelect(
      [
        makeCase("1", []),
        makeCase("2", ["https://cdn.example/a.png"], "posted\nscam links"),
        makeCase("3", ["https://cdn.example/b.png", "https://cdn.example/c.pdf"]),
      ],
      false,
    )?.toJSON();

    const select = row?.components[0];
    expect(select).toMatchObject({
      type: ComponentType.StringSelect,
      custom_id: MODVIEW_CUSTOM_IDS.historyAttachments,
      disabled: false,
    });
    expect(
      select?.type === ComponentType.StringSelect ? select.options : [],
    ).toEqual([
      { value: "2", label: "Case #2 · Ban", description: "posted scam links" },
      { value: "3", label: "Case #3 · Ban", description: "2 attachments" },
    ]);
  });

  test("absent when no case on the page has attachments", () => {
    expect(buildAttachmentSelect([makeCase("1", [""])], false)).toBeNull();
  });
});

describe("buildCaseAttachmentsMessage", () => {
  test("media in a gallery, other files as links, sent privately", () => {
    const message = buildCaseAttachmentsMessage(
      makeCase("7", [
        "https://cdn.example/a.png",
        "https://cdn.example/notes.pdf",
      ]),
      emojis,
    );
    const container = message.components[0].toJSON();

    expect(message.flags & MessageFlags.Ephemeral).toBeTruthy();
    expect(container.components.map((c) => c.type)).toEqual([
      ComponentType.TextDisplay,
      ComponentType.MediaGallery,
      ComponentType.TextDisplay,
    ]);
    expect(container.components[1]).toMatchObject({
      items: [{ media: { url: "https://cdn.example/a.png" } }],
    });
    expect(container.components[2]).toMatchObject({
      content: ":attachment: [notes.pdf](https://cdn.example/notes.pdf)",
    });
  });
});
