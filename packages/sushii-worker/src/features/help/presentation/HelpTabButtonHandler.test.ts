import { describe, expect, mock, test } from "bun:test";
import type {
  APIActionRowComponent,
  APIButtonComponent,
  APIContainerComponent,
  ButtonInteraction,
  PermissionsBitField,
} from "discord.js";
import { ComponentType, MessageFlags } from "discord.js";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import {
  ALL_EMOJIS,
  KNOWN_MENTIONS,
  PERMISSIONS,
  catalogCommandList,
} from "@/test/fixtures/help";

import { HELP_EMOJI_NAMES } from "../domain/helpCatalog";
import { HelpRenderer } from "./HelpRenderer";
import type { HelpPayload } from "./HelpRenderer";
import { HelpTabButtonHandler } from "./HelpTabButtonHandler";

function setup() {
  const emojiRepository = {
    getEmojis: mock(async () => ALL_EMOJIS),
  } as unknown as BotEmojiRepository;
  const renderer = new HelpRenderer(
    catalogCommandList,
    emojiRepository,
    KNOWN_MENTIONS,
    () => new Date("2026-10-26T12:00:00Z"),
  );
  return { handler: new HelpTabButtonHandler(renderer), emojiRepository };
}

const OWNER_ID = "150443906511667200";
const OTHER_ID = "80351110224678912";

function click(
  customId: string,
  permissions: PermissionsBitField | null,
  userId = OWNER_ID,
) {
  const update = mock((_payload: HelpPayload) => Promise.resolve());
  const reply = mock((_payload: HelpPayload) => Promise.resolve());
  const interaction = {
    customId,
    memberPermissions: permissions,
    guildId: "167058919611564043",
    user: { id: userId },
    update,
    reply,
  } as unknown as ButtonInteraction;
  return { interaction, update, reply };
}

function activeTab(payload: HelpPayload): string | undefined {
  const container = payload.components[0].toJSON() as APIContainerComponent;
  const row = container.components.find(
    (c) => c.type === ComponentType.ActionRow,
  ) as APIActionRowComponent<APIButtonComponent> | undefined;
  const active = row?.components.find((b) => b.disabled);
  return active && "label" in active ? active.label : undefined;
}

describe("HelpTabButtonHandler", () => {
  test("matches only help tab IDs", () => {
    const { handler } = setup();

    expect(handler.customIDMatch(`help:tab:admins:${OWNER_ID}`)).not.toBe(
      false,
    );
    expect(handler.customIDMatch("help:tab:admins")).not.toBe(false);
    expect(handler.customIDMatch(`help:tab:owners:${OWNER_ID}`)).toBe(false);
    expect(handler.customIDMatch("help:tab:admins:")).toBe(false);
    expect(handler.customIDMatch("help:tab:admins:1:2")).toBe(false);
    expect(handler.customIDMatch("settings:tab:admins")).toBe(false);
  });

  test("updates the message in place with the requested tab", async () => {
    const { handler, emojiRepository } = setup();
    const { interaction, update } = click(
      `help:tab:admins:${OWNER_ID}`,
      PERMISSIONS.admin,
    );

    await handler.handleInteraction(interaction);

    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][0];
    expect(activeTab(payload)).toBe("Admins");
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(emojiRepository.getEmojis).toHaveBeenCalledWith(HELP_EMOJI_NAMES);
  });

  test("re-checks permissions and falls back to Members", async () => {
    const { handler } = setup();
    const { interaction, update } = click(
      `help:tab:admins:${OWNER_ID}`,
      PERMISSIONS.moderator,
    );

    await handler.handleInteraction(interaction);

    const payload = update.mock.calls[0][0];
    const content = JSON.stringify(payload.components[0].toJSON());
    expect(activeTab(payload)).toBe("Members");
    expect(content).not.toContain("Server setup");
  });

  test("a member who lost mod permissions gets Members with no tabs", async () => {
    const { handler } = setup();
    const { interaction, update } = click(
      `help:tab:moderators:${OWNER_ID}`,
      PERMISSIONS.member,
    );

    await handler.handleInteraction(interaction);

    const payload = update.mock.calls[0][0];
    const content = JSON.stringify(payload.components[0].toJSON());
    expect(activeTab(payload)).toBeUndefined();
    expect(content).toContain("What sushii can do");
    expect(content).not.toContain("Moderation");
  });

  test("someone else's click gets a private copy and leaves the message alone", async () => {
    const { handler } = setup();
    const { interaction, update, reply } = click(
      `help:tab:moderators:${OWNER_ID}`,
      PERMISSIONS.moderator,
      OTHER_ID,
    );

    await handler.handleInteraction(interaction);

    expect(update).not.toHaveBeenCalled();
    const payload = reply.mock.calls[0][0];
    expect(payload.flags).toBe(
      MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    );
    expect(activeTab(payload)).toBe("Moderators");
    expect(JSON.stringify(payload.components[0].toJSON())).toContain(
      `help:tab:members:${OTHER_ID}`,
    );
  });

  test("tabs on older private replies still update for whoever clicks", async () => {
    const { handler } = setup();
    const { interaction, update, reply } = click(
      "help:tab:admins",
      PERMISSIONS.admin,
      OTHER_ID,
    );

    await handler.handleInteraction(interaction);

    expect(reply).not.toHaveBeenCalled();
    expect(activeTab(update.mock.calls[0][0])).toBe("Admins");
  });
});
