import { describe, expect, test } from "bun:test";
import type {
  APIActionRowComponent,
  APIButtonComponentWithCustomId,
  APIContainerComponent,
  APISectionComponent,
  APITextDisplayComponent,
} from "discord.js";
import { ButtonStyle, ComponentType, MessageFlags } from "discord.js";

import type { ReasonTemplatePage } from "../../application/ReasonTemplateService";
import type { ReasonTemplate } from "../../domain/ReasonTemplate";
import { parsePanelId } from "../customIds";
import {
  buildDeleteConfirmMessage,
  buildDetailMessage,
  buildListMessage,
} from "./ReasonTemplatesPanelView";

const emojis = {
  reason: "<:reason:1400000000000000001>",
  message_edit: "<:message_edit:1400000000000000002>",
  trash: "<:trash:1400000000000000003>",
};

function template(overrides: Partial<ReasonTemplate> = {}): ReasonTemplate {
  return {
    id: "11",
    guildId: "1029384756102938475",
    shortcut: "spam",
    content:
      "Spamming in channels (rule 3). Repeated messages, mass mentions or unrelated links.",
    contentKey: "key",
    createdBy: "238381427315195904",
    createdAt: new Date("2026-09-17T12:00:00Z"),
    updatedAt: null,
    useCount: 14,
    lastUsedAt: new Date("2026-10-27T11:58:00Z"),
    ...overrides,
  };
}

function page(
  items: ReasonTemplate[],
  current: number,
  pages: number,
  total: number,
): ReasonTemplatePage {
  return { items, page: current, pages, total };
}

function container(message: { components?: unknown }): APIContainerComponent {
  const [root] = message.components as { toJSON(): APIContainerComponent }[];
  return root.toJSON();
}

function texts(root: APIContainerComponent): string[] {
  return root.components.flatMap((c) => {
    if (c.type === ComponentType.TextDisplay) {
      return [(c as APITextDisplayComponent).content];
    }
    if (c.type === ComponentType.Section) {
      return (c as APISectionComponent).components.map((t) => t.content);
    }
    return [];
  });
}

function rows(root: APIContainerComponent): APIButtonComponentWithCustomId[][] {
  return root.components
    .filter((c) => c.type === ComponentType.ActionRow)
    .map(
      (row) =>
        (row as APIActionRowComponent<APIButtonComponentWithCustomId>)
          .components,
    );
}

function sections(root: APIContainerComponent): APISectionComponent[] {
  return root.components.filter(
    (c): c is APISectionComponent => c.type === ComponentType.Section,
  );
}

describe("buildListMessage", () => {
  test("empty state names Save as template and only offers Add", () => {
    const message = buildListMessage(page([], 1, 1, 0), emojis);
    const root = container(message);

    expect(message.flags).toBe(MessageFlags.IsComponentsV2);
    expect(message.allowedMentions).toEqual({ parse: [] });
    expect(texts(root)[0]).toBe(
      `## ${emojis.reason} Reason templates\n-# 0 templates · shared with all mods · start any reason with \`!shortcut\``,
    );
    expect(texts(root)[1]).toContain("**Save as template**");
    expect(sections(root)).toHaveLength(0);
    expect(rows(root)).toEqual([
      [
        expect.objectContaining({
          label: "Add template",
          style: ButtonStyle.Primary,
          custom_id: "reasonTemplates/add",
        }),
      ],
    ]);
  });

  test("single page lists each template with a Manage button and no paging", () => {
    const items = [
      template(),
      template({ id: "14", shortcut: null, useCount: 1 }),
    ];
    const root = container(buildListMessage(page(items, 1, 1, 2), emojis));

    expect(texts(root)[0]).toContain("2 templates");
    const [first, second] = sections(root);
    expect(first.components[0].content).toStartWith(
      "**`!spam`** · used 14 times\nSpamming",
    );
    expect(second.components[0].content).toStartWith(
      "-# no shortcut · used 1 time\n",
    );
    expect(first.accessory).toMatchObject({
      label: "Manage",
      style: ButtonStyle.Secondary,
      custom_id: "reasonTemplates/manage/11/1",
    });
    expect(rows(root)).toHaveLength(1);
  });

  test("long template text is shortened in the row", () => {
    const root = container(
      buildListMessage(
        page([template({ content: "word ".repeat(100) })], 1, 1, 1),
        emojis,
      ),
    );
    const [, preview] = sections(root)[0].components[0].content.split("\n");

    expect(preview.length).toBeLessThanOrEqual(140);
    expect(preview.endsWith("…")).toBe(true);
  });

  test("multi-page puts paging on its own row above Add template", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      template({ id: String(20 + i), shortcut: `s${i}` }),
    );
    const root = container(buildListMessage(page(items, 2, 3, 12), emojis));
    const [paging, add] = rows(root);

    expect(paging.map((b) => b.label)).toEqual([
      "Previous",
      "Page 2 of 3",
      "Next",
    ]);
    expect(paging.map((b) => b.disabled ?? false)).toEqual([
      false,
      true,
      false,
    ]);
    expect(parsePanelId(paging[0].custom_id)).toEqual({
      action: "page",
      page: 1,
    });
    expect(parsePanelId(paging[2].custom_id)).toEqual({
      action: "page",
      page: 3,
    });
    expect(add.map((b) => b.label)).toEqual(["Add template"]);
  });

  test("first and last pages disable the matching button", () => {
    const first = rows(
      container(buildListMessage(page([template()], 1, 3, 12), emojis)),
    )[0];
    const last = rows(
      container(buildListMessage(page([template()], 3, 3, 12), emojis)),
    )[0];

    expect(first[0].disabled).toBe(true);
    expect(first[2].disabled).toBe(false);
    expect(last[0].disabled).toBe(false);
    expect(last[2].disabled).toBe(true);
  });

  test("custom IDs are unique within the message", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      template({ id: String(20 + i) }),
    );
    const root = container(buildListMessage(page(items, 2, 3, 12), emojis));
    const ids = [
      ...sections(root).map(
        (s) => (s.accessory as APIButtonComponentWithCustomId).custom_id,
      ),
      ...rows(root).flatMap((r) => r.map((b) => b.custom_id)),
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("notice goes on top", () => {
    const root = container(
      buildListMessage(page([], 1, 1, 0), emojis, "Deleted `!spam`"),
    );

    expect(texts(root)[0]).toBe("-# Deleted `!spam`");
  });
});

describe("buildDetailMessage", () => {
  test("with a shortcut", () => {
    const message = buildDetailMessage(template(), 2, emojis);
    const root = container(message);
    const [heading, body, meta] = texts(root);

    expect(message.allowedMentions).toEqual({ parse: [] });
    expect(heading).toBe("## Template\n**Shortcut:** `!spam`");
    expect(body).toBe(`>>> ${template().content}`);
    expect(meta).toBe(
      "-# Added by <@238381427315195904> <t:1789646400:R> · used 14 times · last used <t:1793102280:R>",
    );

    const [buttons] = rows(root);
    expect(buttons.map((b) => [b.label, b.style])).toEqual([
      ["Edit", ButtonStyle.Secondary],
      ["Delete", ButtonStyle.Danger],
      ["Back", ButtonStyle.Secondary],
    ]);
    expect(buttons[0].emoji).toMatchObject({ name: "message_edit" });
    expect(buttons[1].emoji).toMatchObject({ name: "trash" });
    expect(buttons.map((b) => parsePanelId(b.custom_id))).toEqual([
      { action: "edit", templateId: "11", page: 2 },
      { action: "delete", templateId: "11", page: 2 },
      { action: "page", page: 2 },
    ]);
  });

  test("without a shortcut, never used", () => {
    const root = container(
      buildDetailMessage(
        template({ shortcut: null, useCount: 0, lastUsedAt: null }),
        1,
        emojis,
      ),
    );
    const [heading, , meta] = texts(root);

    expect(heading).toBe(
      "## Template\n**Shortcut:** none. Add one with Edit to type it in reasons.",
    );
    expect(meta).not.toContain("last used");
    expect(meta).toContain("used 0 times");
  });
});

describe("buildDeleteConfirmMessage", () => {
  test("quotes every line and never uses a block quote", () => {
    const root = container(
      buildDeleteConfirmMessage(
        template({ content: "Line one.\nLine two." }),
        3,
      ),
    );
    const [text] = texts(root);

    expect(text).toBe(
      "### Delete `!spam`?\n> Line one.\n> Line two.\n-# Past cases keep their reason text. `!spam` stops working in new reasons.",
    );
    expect(text).not.toContain(">>>");

    const [buttons] = rows(root);
    expect(buttons.map((b) => [b.label, b.style])).toEqual([
      ["Delete", ButtonStyle.Danger],
      ["Cancel", ButtonStyle.Secondary],
    ]);
    expect(buttons.map((b) => parsePanelId(b.custom_id))).toEqual([
      { action: "deleteConfirm", templateId: "11", page: 3 },
      { action: "manage", templateId: "11", page: 3 },
    ]);
  });

  test("without a shortcut", () => {
    const [text] = texts(
      container(buildDeleteConfirmMessage(template({ shortcut: null }), 1)),
    );

    expect(text).toStartWith("### Delete this template?\n> ");
    expect(text).toEndWith("\n-# Past cases keep their reason text.");
  });

  test("long text is shortened", () => {
    const [text] = texts(
      container(
        buildDeleteConfirmMessage(template({ content: "a".repeat(3000) }), 1),
      ),
    );

    expect(text.length).toBeLessThan(400);
  });
});
