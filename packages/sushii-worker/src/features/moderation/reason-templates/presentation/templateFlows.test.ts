import { describe, expect, mock, test } from "bun:test";
import type { ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import {
  ButtonInteraction as ButtonInteractionClass,
  DiscordjsError,
  DiscordjsErrorCodes,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
} from "discord.js";
import pino from "pino";
import { Err, Ok } from "ts-results";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";

import { ReasonTemplateService } from "../application/ReasonTemplateService";
import type { ReasonTemplate } from "../domain/ReasonTemplate";
import { buildAddId, buildTemplateActionId } from "./customIds";
import { ReasonTemplatesPanelButtonHandler } from "./handlers/ReasonTemplatesPanelButtonHandler";
import { showSaveTemplateModal } from "./showSaveTemplateModal";

const GUILD_ID = "1029384756102938475";
const USER_ID = "150443906511667200";
const MOD = new PermissionsBitField(PermissionFlagsBits.BanMembers);
const NOT_MOD = new PermissionsBitField(PermissionFlagsBits.SendMessages);

const DiscordjsErrorCtor = DiscordjsError as unknown as new (
  code: DiscordjsErrorCodes,
  ...args: unknown[]
) => DiscordjsError;

function template(overrides: Partial<ReasonTemplate> = {}): ReasonTemplate {
  return {
    id: "11",
    guildId: GUILD_ID,
    shortcut: "spam",
    content: "Spamming in channels.",
    contentKey: "key",
    createdBy: USER_ID,
    createdAt: new Date("2026-09-17T12:00:00Z"),
    updatedAt: null,
    useCount: 0,
    lastUsedAt: null,
    ...overrides,
  };
}

function makeService() {
  const service = Object.create(
    ReasonTemplateService.prototype,
  ) as ReasonTemplateService;
  const list = mock((_g: string, page: number) =>
    Promise.resolve({ items: [template()], total: 1, page, pages: 1 }),
  );
  const get = mock(() => Promise.resolve<ReasonTemplate | null>(template()));
  const create = mock(() =>
    Promise.resolve(Ok(template({ id: "16" })) as never),
  );
  const update = mock(() => Promise.resolve(Ok(template()) as never));
  const remove = mock(() => Promise.resolve(true));
  Object.assign(service, { list, get, create, update, delete: remove });

  return { service, list, get, create, update, remove };
}

const emojiRepository = {
  getEmojis: mock((names: readonly string[]) =>
    Promise.resolve(
      Object.fromEntries(names.map((n) => [n, `<:${n}:1400000000000000001>`])),
    ),
  ),
} as unknown as Pick<BotEmojiRepository, "getEmojis">;

function makeSubmit({
  fromMessage = true,
  permissions = MOD,
  fields = { shortcut: "spam", content: "Spamming in channels." },
}: {
  fromMessage?: boolean;
  permissions?: PermissionsBitField;
  fields?: Record<string, string>;
} = {}) {
  const update = mock(async (_options: unknown) => undefined);
  const reply = mock(async (_options: unknown) => undefined);
  const followUp = mock(async (_options: unknown) => undefined);
  const submit = {
    guildId: GUILD_ID,
    user: { id: USER_ID },
    memberPermissions: permissions,
    fields: { getTextInputValue: (id: string) => fields[id] ?? "" },
    isFromMessage: () => fromMessage,
    update,
    reply,
    followUp,
  } as unknown as ModalSubmitInteraction<"cached">;

  return { submit, update, reply, followUp };
}

function makeButton(
  customId: string,
  submit: ModalSubmitInteraction<"cached"> | "timeout",
  permissions = MOD,
) {
  const interaction = Object.create(
    ButtonInteractionClass.prototype,
  ) as ButtonInteraction<"cached">;
  const update = mock(async (_options: unknown) => undefined);
  const reply = mock(async (_options: unknown) => undefined);
  const showModal = mock(async (_modal: unknown) => undefined);
  const awaitModalSubmit = mock(async () => {
    if (submit === "timeout") {
      throw new DiscordjsErrorCtor(
        DiscordjsErrorCodes.InteractionCollectorError,
        "time",
      );
    }
    return submit;
  });

  for (const [key, value] of Object.entries({
    customId,
    guildId: GUILD_ID,
    user: { id: USER_ID },
    memberPermissions: permissions,
    inCachedGuild: () => true,
    update,
    reply,
    showModal,
    awaitModalSubmit,
  })) {
    Object.defineProperty(interaction, key, { value });
  }

  return { interaction, update, reply, showModal, awaitModalSubmit };
}

function handler(service: ReasonTemplateService) {
  return new ReasonTemplatesPanelButtonHandler(
    service,
    emojiRepository,
    pino({ level: "silent" }),
  );
}

function contentOf(options: unknown): string {
  return JSON.stringify(
    (options as { components: { toJSON(): unknown }[] }).components.map((c) =>
      c.toJSON(),
    ),
  );
}

describe("ReasonTemplatesPanelButtonHandler", () => {
  test("add from the panel updates it in place on the last page", async () => {
    const { service, create, list } = makeService();
    const modal = makeSubmit();
    const button = makeButton(buildAddId(), modal.submit);

    await handler(service).handleInteraction(button.interaction);

    expect(button.showModal).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(GUILD_ID, {
      shortcut: "spam",
      content: "Spamming in channels.",
      createdBy: USER_ID,
    });
    expect(list).toHaveBeenLastCalledWith(GUILD_ID, Number.MAX_SAFE_INTEGER);
    expect(modal.update).toHaveBeenCalledTimes(1);
    expect(modal.reply).not.toHaveBeenCalled();
    expect(contentOf(modal.update.mock.calls[0][0])).toContain("Added `!spam`");
  });

  test("add from a submit not tied to a message replies instead", async () => {
    const { service } = makeService();
    const modal = makeSubmit({ fromMessage: false });

    await handler(service).handleInteraction(
      makeButton(buildAddId(), modal.submit).interaction,
    );

    expect(modal.reply).toHaveBeenCalledTimes(1);
    expect(modal.update).not.toHaveBeenCalled();
  });

  test("a timed out form does nothing", async () => {
    const { service, create } = makeService();
    const button = makeButton(buildAddId(), "timeout");

    await handler(service).handleInteraction(button.interaction);

    expect(button.showModal).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(button.reply).not.toHaveBeenCalled();
    expect(button.update).not.toHaveBeenCalled();
  });

  test("a submit without mod permissions is refused", async () => {
    const { service, create } = makeService();
    const modal = makeSubmit({ permissions: NOT_MOD });

    await handler(service).handleInteraction(
      makeButton(buildAddId(), modal.submit).interaction,
    );

    expect(create).not.toHaveBeenCalled();
    expect(modal.reply).toHaveBeenCalledTimes(1);
    expect(contentOf(modal.reply.mock.calls[0][0])).toContain("You need");
    expect(modal.update).not.toHaveBeenCalled();
  });

  test("service errors reply privately and leave the panel alone", async () => {
    const { service, create } = makeService();
    create.mockImplementation(() =>
      Promise.resolve(
        Err({ code: "invalid_shortcut", shortcut: "spam bot" }) as never,
      ),
    );
    const modal = makeSubmit();

    await handler(service).handleInteraction(
      makeButton(buildAddId(), modal.submit).interaction,
    );

    expect(modal.update).not.toHaveBeenCalled();
    const [options] = modal.reply.mock.calls[0] as [{ flags: number }];
    expect(options.flags & MessageFlags.Ephemeral).toBeTruthy();
    expect(contentOf(options)).toContain("can't be a shortcut");
  });

  test("delete confirm on an already deleted template shows the notice", async () => {
    const { service, get, remove } = makeService();
    get.mockImplementation(() => Promise.resolve(null));
    const button = makeButton(
      buildTemplateActionId("deleteConfirm", "11", 2),
      "timeout",
    );

    await handler(service).handleInteraction(button.interaction);

    expect(remove).not.toHaveBeenCalled();
    expect(contentOf(button.update.mock.calls[0][0])).toContain(
      "That template was already deleted.",
    );
  });

  test("edit of a template deleted while the form was open refreshes the panel", async () => {
    const { service, update, list } = makeService();
    update.mockImplementation(() =>
      Promise.resolve(Err({ code: "not_found" }) as never),
    );
    const modal = makeSubmit();

    await handler(service).handleInteraction(
      makeButton(buildTemplateActionId("edit", "11", 2), modal.submit)
        .interaction,
    );

    expect(list).toHaveBeenLastCalledWith(GUILD_ID, 2);
    expect(modal.reply).not.toHaveBeenCalled();
    expect(contentOf(modal.update.mock.calls[0][0])).toContain(
      "That template was already deleted.",
    );
  });

  test("a non-mod click is refused before anything loads", async () => {
    const { service, get } = makeService();
    const button = makeButton(
      buildTemplateActionId("manage", "11", 1),
      "timeout",
      NOT_MOD,
    );

    await handler(service).handleInteraction(button.interaction);

    expect(get).not.toHaveBeenCalled();
    expect(button.reply).toHaveBeenCalledTimes(1);
  });
});

describe("showSaveTemplateModal", () => {
  test("buildUpdate updates the message, then the confirmation follows privately", async () => {
    const { service, create } = makeService();
    const modal = makeSubmit();
    const button = makeButton("modAction/save/1", modal.submit);
    const buildUpdate = mock(async (_t: ReasonTemplate, _s: unknown) => ({
      components: [],
    }));

    const result = await showSaveTemplateModal(
      button.interaction,
      { prefillContent: "Spamming in channels.", buildUpdate },
      { reasonTemplateService: service, emojiRepository },
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.ok && result.val.template.id).toBe("16");
    expect(buildUpdate).toHaveBeenCalledWith(
      template({ id: "16" }),
      modal.submit,
    );
    expect(modal.update).toHaveBeenCalledWith({ components: [] });
    expect(modal.reply).not.toHaveBeenCalled();
    const [confirmation] = modal.followUp.mock.calls[0] as [{ flags: number }];
    expect(confirmation.flags & MessageFlags.Ephemeral).toBeTruthy();
    expect(contentOf(confirmation)).toContain("Template saved");
  });

  test("without buildUpdate the confirmation is the reply", async () => {
    const { service } = makeService();
    const modal = makeSubmit();

    await showSaveTemplateModal(
      makeButton("modAction/save/1", modal.submit).interaction,
      { prefillContent: "x" },
      { reasonTemplateService: service, emojiRepository },
    );

    expect(modal.reply).toHaveBeenCalledTimes(1);
    expect(modal.update).not.toHaveBeenCalled();
  });

  test("a dismissed form returns dismissed without answering", async () => {
    const { service, create } = makeService();
    const button = makeButton("modAction/save/1", "timeout");

    const result = await showSaveTemplateModal(
      button.interaction,
      { prefillContent: "x" },
      { reasonTemplateService: service, emojiRepository },
    );

    expect(result.err && result.val).toEqual({ code: "dismissed" });
    expect(create).not.toHaveBeenCalled();
    expect(button.reply).not.toHaveBeenCalled();
  });

  test("errors are answered and returned, and buildUpdate isn't called", async () => {
    const { service, create } = makeService();
    create.mockImplementation(() =>
      Promise.resolve(Err({ code: "limit_reached", limit: 100 }) as never),
    );
    const modal = makeSubmit();
    const buildUpdate = mock(async () => ({ components: [] }));

    const result = await showSaveTemplateModal(
      makeButton("modAction/save/1", modal.submit).interaction,
      { prefillContent: "x", buildUpdate },
      { reasonTemplateService: service, emojiRepository },
    );

    expect(result.err && result.val).toEqual({
      code: "limit_reached",
      limit: 100,
    });
    expect(buildUpdate).not.toHaveBeenCalled();
    expect(modal.reply).toHaveBeenCalledTimes(1);
  });
});
