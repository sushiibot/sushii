import { sleep } from "bun";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  ChatInputCommandInteraction,
  MessageComponentInteraction,
  ModalSubmitFields,
} from "discord.js";
import {
  ChannelType,
  ComponentType,
  DiscordjsError,
  DiscordjsErrorCodes,
  MessageFlags,
  ModalSubmitFields as ModalSubmitFieldsClass,
  ModalSubmitInteraction,
} from "discord.js";
import type { Logger } from "pino";

import type {
  BotEmojiRepository,
  EmojiMap,
} from "@/features/bot-emojis/domain";
import type {
  ScreeningSettingsPort,
  ScreeningSettingsState,
} from "@/features/member-screening/application/ScreeningSettingsPort";
import { MessageLogBlock } from "@/features/message-log/domain/entities/MessageLogBlock";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import { GuildSettingsService } from "../../application/GuildSettingsService";
import { MessageLogBlockService } from "../../application/MessageLogBlockService";
import { SETTINGS_TABS } from "../../domain/SettingsTargets";
import { settingsIds } from "../session/settingsIds";
import { PANEL_EMOJI_NAMES } from "../views/panel/SettingsPanel";
import SettingsCommand from "./SettingsCommand";

const GUILD_ID = "123456789012345678";
const USER_ID = "345678901234567890";
const OTHER_USER_ID = "345678901234567891";
const MESSAGE_ID = "456789012345678000";
const CH = {
  mod: "234567890123456701",
  member: "234567890123456702",
  message: "234567890123456703",
  reaction: "234567890123456704",
  welcome: "234567890123456705",
  alerts: "234567890123456706",
  screening: "234567890123456707",
};
const EXPIRED_TEXT = "Expired after 5 minutes idle";

const DiscordjsErrorCtor = DiscordjsError as unknown as new (
  code: DiscordjsErrorCodes,
  ...args: unknown[]
) => DiscordjsError;

const mockEmojis = Object.fromEntries(
  PANEL_EMOJI_NAMES.map((name) => [name, `<:${name}:100000000000000000>`]),
) as EmojiMap<typeof PANEL_EMOJI_NAMES>;

interface Payload {
  components: { toJSON(): unknown }[];
  flags?: unknown;
}

function expectDeferredThenEdited(
  deferUpdate: { mock: { invocationCallOrder: number[] } },
  editReply: { mock: { invocationCallOrder: number[] } },
) {
  expect(deferUpdate.mock.invocationCallOrder).toHaveLength(1);
  expect(editReply.mock.invocationCallOrder).toHaveLength(1);
  expect(deferUpdate.mock.invocationCallOrder[0]).toBeLessThan(
    editReply.mock.invocationCallOrder[0],
  );
}

function json(payload: Payload): string {
  return JSON.stringify(payload.components.map((c) => c.toJSON()));
}

interface ButtonJson {
  custom_id: string;
  disabled?: boolean;
  emoji?: { id?: string; name?: string };
}

function findFeedbackButtons(node: unknown): ButtonJson[] {
  if (Array.isArray(node)) {
    return node.flatMap(findFeedbackButtons);
  }
  if (!node || typeof node !== "object") {
    return [];
  }
  const own =
    "custom_id" in node &&
    typeof node.custom_id === "string" &&
    node.custom_id.startsWith("feedback/")
      ? [node as ButtonJson]
      : [];
  return [...own, ...Object.values(node).flatMap(findFeedbackButtons)];
}

function feedbackButton(payload: Payload): ButtonJson {
  const buttons = findFeedbackButtons(
    payload.components.map((c) => c.toJSON()),
  );
  expect(buttons).toHaveLength(1);
  return buttons[0];
}

class FakeScreeningPort implements ScreeningSettingsPort {
  state: ScreeningSettingsState | null = {
    enabled: false,
    logChannelId: null,
    checkAvatars: true,
  };

  getForSettings = mock(async (_guildId: string) => this.state);
  setLogChannel = mock(async (_guildId: string, channelId: string | null) => {
    if (this.state) {
      this.state = {
        ...this.state,
        logChannelId: channelId,
        enabled: channelId !== null,
      };
    }
  });
  setCheckAvatars = mock(async (_guildId: string, checkAvatars: boolean) => {
    if (this.state) {
      this.state = { ...this.state, checkAvatars };
    }
  });
}

function createCommand(
  port: ScreeningSettingsPort | null,
  emojis: Record<string, string> = mockEmojis,
) {
  let config = GuildConfig.createDefault(GUILD_ID);
  let ignored: string[] = [];

  const guildSettingsService = Object.create(
    GuildSettingsService.prototype,
  ) as GuildSettingsService;
  const getGuildSettings = mock(async () => config);
  const apply = mock(async () => config);
  guildSettingsService.getGuildSettings = getGuildSettings;
  guildSettingsService.apply = apply;

  const messageLogBlockService = Object.create(
    MessageLogBlockService.prototype,
  ) as MessageLogBlockService;
  messageLogBlockService.getIgnoredChannels = mock(async () =>
    ignored.map((id) => new MessageLogBlock(GUILD_ID, id)),
  );
  const setIgnoredChannels = mock(async () => undefined);
  messageLogBlockService.setIgnoredChannels = setIgnoredChannels;

  const logger = {
    debug: mock(() => undefined),
    info: mock(() => undefined),
    warn: mock(() => undefined),
    error: mock(() => undefined),
  };

  const emojiRepository = {
    getEmojis: mock(async () => emojis),
  } as unknown as BotEmojiRepository;

  return {
    command: new SettingsCommand(
      guildSettingsService,
      messageLogBlockService,
      logger as unknown as Logger,
      emojiRepository,
      port,
      0,
    ),
    logger,
    getGuildSettings,
    apply,
    setIgnoredChannels,
    setConfig: (next: GuildConfig) => {
      config = next;
    },
    setIgnored: (ids: string[]) => {
      ignored = ids;
    },
  };
}

type Handler = (...args: unknown[]) => Promise<void>;

function startPanel(command: SettingsCommand) {
  const handlers: Record<string, Handler> = {};
  const collector = {
    ended: false,
    resetTimer: mock(() => undefined),
    on: (event: string, fn: Handler) => {
      handlers[event] = fn;
      return collector;
    },
  };
  const createCollector = mock(
    (_opts: { idle: number; filter: (i: { customId: string }) => boolean }) =>
      collector,
  );
  const reply = mock(async (_payload: Payload & { withResponse: boolean }) => ({
    resource: {
      message: {
        id: MESSAGE_ID,
        createMessageComponentCollector: createCollector,
      },
    },
  }));
  const editReply = mock(async (_payload: Payload) => undefined);
  const channelEdit = mock(async (_id: string, _payload: Payload) => undefined);
  const textChannels = new Set<string>();
  const channelGet = mock((id: string) =>
    textChannels.has(id) ? { type: ChannelType.GuildText } : undefined,
  );
  const guild = {
    id: GUILD_ID,
    name: "ONCE Lounge",
    memberCount: 48213,
    channels: { cache: { get: channelGet } },
    roles: { cache: new Map() },
    members: { me: null },
  };
  const interaction = {
    inCachedGuild: () => true,
    guildId: GUILD_ID,
    user: { id: USER_ID, username: "nayeon" },
    guild,
    channel: { messages: { edit: channelEdit } },
    reply,
    editReply,
  } as unknown as ChatInputCommandInteraction;

  return {
    interaction,
    guild,
    collector,
    createCollector,
    reply,
    editReply,
    channelEdit,
    channelGet,
    textChannels,
    run: () => command.handler(interaction),
    collect: (i: MessageComponentInteraction) => handlers.collect(i),
    end: (reason = "idle") => handlers.end(new Map(), reason),
  };
}

type Panel = ReturnType<typeof startPanel>;

function createButton(
  panel: Panel,
  customId: string,
  userId: string = USER_ID,
) {
  const deferUpdate = mock(async () => {
    interaction.deferred = true;
  });
  const editReply = mock(async (_payload: Payload) => undefined);
  const followUp = mock(async (_payload: Payload) => undefined);
  const rejection = { delete: mock(async () => undefined) };
  const reply = mock(async (_payload: unknown) => rejection);
  const showModal = mock(async (_modal: unknown) => undefined);
  const awaitModalSubmit = mock(async (_opts: unknown): Promise<unknown> => {
    throw new Error("awaitModalSubmit not stubbed");
  });
  const interaction = {
    id: "567890123456789012",
    customId,
    user: { id: userId },
    guildId: GUILD_ID,
    guild: panel.guild,
    inCachedGuild: () => true,
    isButton: () => true,
    deferred: false,
    deferUpdate,
    editReply,
    followUp,
    reply,
    showModal,
    awaitModalSubmit,
  };

  return {
    interaction: interaction as unknown as MessageComponentInteraction,
    deferUpdate,
    editReply,
    followUp,
    reply,
    rejection,
    showModal,
    awaitModalSubmit,
  };
}

const transformComponent = (
  ModalSubmitInteraction as unknown as {
    transformComponent(raw: unknown): unknown;
  }
).transformComponent.bind(ModalSubmitInteraction);

const ModalSubmitFieldsCtor = ModalSubmitFieldsClass as unknown as new (
  components: unknown[],
) => ModalSubmitFields;

function createSubmission(components: Record<string, unknown>[]) {
  const raw = components.map((component, i) => ({
    type: ComponentType.Label,
    id: i + 1,
    component,
  }));
  const deferUpdate = mock(async () => undefined);
  const editReply = mock(async (_payload: Payload) => undefined);
  const followUp = mock(async (_payload: Payload) => undefined);
  const submission = {
    id: "678901234567890123",
    customId: "",
    user: { id: USER_ID },
    guildId: GUILD_ID,
    isFromMessage: () => true,
    fields: new ModalSubmitFieldsCtor(raw.map(transformComponent)),
    deferUpdate,
    editReply,
    followUp,
  };

  return { submission, deferUpdate, editReply, followUp };
}

function submitWith(
  button: ReturnType<typeof createButton>,
  submission: ReturnType<typeof createSubmission>["submission"],
  beforeResolve: () => void = () => undefined,
) {
  button.awaitModalSubmit.mockImplementation(async () => {
    const modal = button.showModal.mock.calls[0][0] as {
      data: { custom_id: string };
    };
    submission.customId = modal.data.custom_id;
    beforeResolve();
    return submission;
  });
}

const channelSelect = (customId: string, values: string[]) => ({
  type: ComponentType.ChannelSelect,
  custom_id: customId,
  values,
});

describe("SettingsCommand", () => {
  let port: FakeScreeningPort;

  beforeEach(() => {
    port = new FakeScreeningPort();
  });

  test("initial reply renders the Overview and loads screening", async () => {
    const { command } = createCommand(port);
    const panel = startPanel(command);

    await panel.run();

    expect(panel.reply).toHaveBeenCalledTimes(1);
    const payload = panel.reply.mock.calls[0][0];
    expect(payload.withResponse).toBe(true);
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    const rendered = json(payload);
    expect(rendered).toContain(settingsIds.tab("overview"));
    expect(rendered).not.toContain(EXPIRED_TEXT);
    expect(port.getForSettings).toHaveBeenCalledWith(GUILD_ID);
    expect(panel.createCollector.mock.calls[0][0].idle).toBe(5 * 60 * 1000);
  });

  test("the collector only takes settings IDs, not feedback buttons", async () => {
    const panel = startPanel(createCommand(port).command);

    await panel.run();

    const footer = feedbackButton(panel.reply.mock.calls[0][0]);
    expect(footer.custom_id).toBe("feedback/panel/settings.overview");
    const { filter } = panel.createCollector.mock.calls[0][0];
    expect(filter({ customId: footer.custom_id })).toBe(false);
    expect(filter({ customId: settingsIds.tab("logging") })).toBe(true);
  });

  test("every tab's footer has a Feedback button keyed to that tab", async () => {
    const panel = startPanel(createCommand(port).command);
    await panel.run();

    for (const tab of SETTINGS_TABS) {
      const button = createButton(panel, settingsIds.tab(tab));
      await panel.collect(button.interaction);

      const footer = feedbackButton(button.editReply.mock.calls[0][0]);
      expect(footer.custom_id).toBe(`feedback/panel/settings.${tab}`);
      expect(footer.disabled).not.toBe(true);
    }
  });

  test("the Feedback button stays enabled on the expired redraw", async () => {
    const panel = startPanel(createCommand(port).command);
    const tab = createButton(panel, settingsIds.tab("welcome"));

    await panel.run();
    await panel.collect(tab.interaction);
    await panel.end();

    const payload = panel.editReply.mock.calls[0][0];
    expect(json(payload)).toContain(EXPIRED_TEXT);
    const footer = feedbackButton(payload);
    expect(footer.custom_id).toBe("feedback/panel/settings.welcome");
    expect(footer.disabled).not.toBe(true);
  });

  test("the Feedback button uses the message app emoji when synced", async () => {
    const panel = startPanel(
      createCommand(port, {
        ...mockEmojis,
        message: "<:message:200000000000000000>",
      }).command,
    );

    await panel.run();

    expect(feedbackButton(panel.reply.mock.calls[0][0]).emoji).toEqual(
      expect.objectContaining({ id: "200000000000000000", name: "message" }),
    );
  });

  test("the Feedback button falls back to 💬 without the app emoji", async () => {
    const panel = startPanel(
      createCommand(port, { ...mockEmojis, message: "" }).command,
    );

    await panel.run();

    expect(feedbackButton(panel.reply.mock.calls[0][0]).emoji).toEqual(
      expect.objectContaining({ name: "💬" }),
    );
  });

  test("checks the health of every configured channel", async () => {
    const { command, setConfig } = createCommand(port);
    const config = GuildConfig.createDefault(GUILD_ID);
    config.loggingSettings.modLogChannel = CH.mod;
    config.loggingSettings.memberLogChannel = CH.member;
    config.loggingSettings.messageLogChannel = CH.message;
    config.loggingSettings.reactionLogChannel = CH.reaction;
    config.messageSettings.messageChannel = CH.welcome;
    config.moderationSettings.automodAlertsChannelId = CH.alerts;
    setConfig(config);
    port.state = {
      enabled: true,
      logChannelId: CH.screening,
      checkAvatars: true,
    };
    const panel = startPanel(command);

    await panel.run();

    const checked = new Set(panel.channelGet.mock.calls.map(([id]) => id));
    expect(checked).toEqual(new Set(Object.values(CH)));
  });

  test("a tab click defers, then re-renders that tab", async () => {
    const panel = startPanel(createCommand(port).command);
    const button = createButton(panel, settingsIds.tab("logging"));

    await panel.run();
    await panel.collect(button.interaction);

    expectDeferredThenEdited(button.deferUpdate, button.editReply);
    const rendered = json(button.editReply.mock.calls[0][0]);
    expect(rendered).toContain(settingsIds.edit("modlog"));
    expect(rendered).not.toContain(EXPIRED_TEXT);
  });

  test("a toggle flips the flag from a fresh config read", async () => {
    const { command, setConfig, apply, getGuildSettings } = createCommand(port);
    const panel = startPanel(command);
    await panel.run();

    const fresh = GuildConfig.createDefault(GUILD_ID);
    fresh.moderationSettings.automodSpamEnabled = true;
    setConfig(fresh);
    const readsBefore = getGuildSettings.mock.calls.length;

    const button = createButton(panel, settingsIds.toggle("spam"));
    await panel.collect(button.interaction);

    expect(getGuildSettings.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(apply).toHaveBeenCalledWith(GUILD_ID, {
      kind: "flag",
      setting: "automodSpam",
      enabled: false,
    });
    expectDeferredThenEdited(button.deferUpdate, button.editReply);
  });

  test("a foreign user's click gets an ephemeral rejection", async () => {
    const { command, apply } = createCommand(port);
    const panel = startPanel(command);
    const button = createButton(
      panel,
      settingsIds.toggle("spam"),
      OTHER_USER_ID,
    );

    await panel.run();
    await panel.collect(button.interaction);

    expect(button.reply).toHaveBeenCalledWith({
      content: expect.stringContaining("Run `/settings` yourself"),
      flags: MessageFlags.Ephemeral,
    });
    expect(button.rejection.delete).toHaveBeenCalledTimes(1);
    expect(button.editReply).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  test("Edit on the message log applies both patches and re-renders", async () => {
    const { command, apply, setIgnoredChannels, setIgnored } =
      createCommand(port);
    const ignored = Array.from(
      { length: 26 },
      (_, n) => `3${String(n).padStart(17, "0")}`,
    );
    setIgnored(ignored);
    const panel = startPanel(command);
    ignored.forEach((id) => panel.textChannels.add(id));
    const tab = createButton(panel, settingsIds.tab("logging"));
    const edit = createButton(panel, settingsIds.edit("msglog"));
    const { submission, deferUpdate, editReply } = createSubmission([
      channelSelect("channel", [CH.message]),
      channelSelect("ignored", ignored.slice(0, 2)),
    ]);
    // A reload after the click would see a different list; parse must use the click-time ctx.
    const reloaded = ignored.map((id) => id.replace(/^3/, "4"));
    submitWith(edit, submission, () => setIgnored(reloaded));

    await panel.run();
    await panel.collect(tab.interaction);
    await panel.collect(edit.interaction);

    expect(edit.showModal).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(GUILD_ID, {
      kind: "logChannel",
      log: "message",
      channelId: CH.message,
    });
    // The 26th channel isn't in the modal; the parser keeps it from the build ctx.
    expect(setIgnoredChannels).toHaveBeenCalledWith(GUILD_ID, [
      ...ignored.slice(0, 2),
      ignored[25],
    ]);
    expect(panel.collector.resetTimer).toHaveBeenCalledTimes(2);
    expectDeferredThenEdited(deferUpdate, editReply);
    expect(deferUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      apply.mock.invocationCallOrder[0],
    );
    const rendered = json(editReply.mock.calls[0][0]);
    expect(rendered).toContain(settingsIds.edit("msglog"));
    expect(rendered).not.toContain(EXPIRED_TEXT);
  });

  test("Edit on the message log keeps a deleted ignored channel it didn't show", async () => {
    const { command, setIgnoredChannels, setIgnored } = createCommand(port);
    const [existing, deleted] = ["300000000000000001", "300000000000000002"];
    setIgnored([existing, deleted]);
    const panel = startPanel(command);
    panel.textChannels.add(existing);
    const edit = createButton(panel, settingsIds.edit("msglog"));
    const { submission } = createSubmission([
      channelSelect("channel", [CH.message]),
      channelSelect("ignored", []),
    ]);
    submitWith(edit, submission);

    await panel.run();
    await panel.collect(edit.interaction);

    const modal = JSON.stringify(
      (edit.showModal.mock.calls[0][0] as { toJSON(): unknown }).toJSON(),
    );
    expect(modal).toContain(existing);
    expect(modal).not.toContain(deleted);
    expect(setIgnoredChannels).toHaveBeenCalledWith(GUILD_ID, [deleted]);
  });

  test("Edit on screening routes the patch to the screening port", async () => {
    port.state = { enabled: true, logChannelId: null, checkAvatars: true };
    const { command, apply } = createCommand(port);
    const panel = startPanel(command);
    const edit = createButton(panel, settingsIds.edit("screening"));
    const { submission, deferUpdate, editReply } = createSubmission([
      channelSelect("channel", [CH.screening]),
      { type: ComponentType.Checkbox, custom_id: "avatars", value: false },
    ]);
    submitWith(edit, submission);

    await panel.run();
    await panel.collect(edit.interaction);

    expect(port.setLogChannel).toHaveBeenCalledWith(GUILD_ID, CH.screening);
    expect(port.setCheckAvatars).toHaveBeenCalledWith(GUILD_ID, false);
    expect(apply).not.toHaveBeenCalled();
    expectDeferredThenEdited(deferUpdate, editReply);
  });

  test("a modal timeout leaves the panel untouched", async () => {
    const { command, apply, setIgnoredChannels } = createCommand(port);
    const panel = startPanel(command);
    const edit = createButton(panel, settingsIds.edit("modlog"));
    edit.awaitModalSubmit.mockImplementation(async () => {
      throw new DiscordjsErrorCtor(
        DiscordjsErrorCodes.InteractionCollectorError,
        "time",
      );
    });

    await panel.run();
    await panel.collect(edit.interaction);

    expect(edit.showModal).toHaveBeenCalledTimes(1);
    expect(edit.editReply).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(setIgnoredChannels).not.toHaveBeenCalled();
    expect(panel.editReply).not.toHaveBeenCalled();
  });

  test("a submit after the collector ended saves and renders expired", async () => {
    const { command, apply } = createCommand(port);
    const panel = startPanel(command);
    const edit = createButton(panel, settingsIds.edit("modlog"));
    const { submission, deferUpdate, editReply } = createSubmission([
      channelSelect("channel", [CH.mod]),
    ]);
    submitWith(edit, submission, () => {
      panel.collector.ended = true;
    });

    await panel.run();
    await panel.collect(edit.interaction);

    expect(apply).toHaveBeenCalledWith(GUILD_ID, {
      kind: "logChannel",
      log: "mod",
      channelId: CH.mod,
    });
    expectDeferredThenEdited(deferUpdate, editReply);
    expect(json(editReply.mock.calls[0][0])).toContain(EXPIRED_TEXT);
  });

  test("on end, the panel is redrawn as expired on the current tab", async () => {
    const panel = startPanel(createCommand(port).command);
    const tab = createButton(panel, settingsIds.tab("automod"));

    await panel.run();
    await panel.collect(tab.interaction);
    await panel.end();

    expect(panel.editReply).toHaveBeenCalledTimes(1);
    const rendered = json(panel.editReply.mock.calls[0][0]);
    expect(rendered).toContain(EXPIRED_TEXT);
    expect(rendered).toContain(settingsIds.toggle("spam"));
    expect(panel.channelEdit).not.toHaveBeenCalled();
  });

  test("on end, a failed reply edit falls back to editing the message", async () => {
    const panel = startPanel(createCommand(port).command);
    panel.editReply.mockImplementation(async () => {
      throw new Error("Invalid Webhook Token");
    });

    await panel.run();
    await panel.end();

    expect(panel.channelEdit).toHaveBeenCalledTimes(1);
    const [messageId, payload] = panel.channelEdit.mock.calls[0];
    expect(messageId).toBe(MESSAGE_ID);
    expect(json(payload)).toContain(EXPIRED_TEXT);
  });

  test("on end, failing both edits doesn't throw", async () => {
    const panel = startPanel(createCommand(port).command);
    panel.editReply.mockImplementation(async () => {
      throw new Error("Invalid Webhook Token");
    });
    panel.channelEdit.mockImplementation(async () => {
      throw new Error("Unknown Message");
    });

    await panel.run();

    await expect(panel.end()).resolves.toBeUndefined();
  });

  test("a failed screening load hides the section", async () => {
    port.getForSettings.mockImplementation(async () => {
      throw new Error("feature flags not loaded");
    });
    const panel = startPanel(createCommand(port).command);
    const tab = createButton(panel, settingsIds.tab("automod"));

    await panel.run();
    await panel.collect(tab.interaction);

    const rendered = json(tab.editReply.mock.calls[0][0]);
    expect(rendered).toContain(settingsIds.toggle("spam"));
    expect(rendered).not.toContain(settingsIds.edit("screening"));
  });

  test("without a screening port the section is hidden", async () => {
    const panel = startPanel(createCommand(null).command);
    const tab = createButton(panel, settingsIds.tab("automod"));

    await panel.run();
    await panel.collect(tab.interaction);

    expect(json(tab.editReply.mock.calls[0][0])).not.toContain(
      settingsIds.edit("screening"),
    );
  });

  test("on end for a deleted message, nothing is redrawn", async () => {
    const panel = startPanel(createCommand(port).command);

    await panel.run();
    await panel.end("messageDelete");

    expect(panel.editReply).not.toHaveBeenCalled();
    expect(panel.channelEdit).not.toHaveBeenCalled();
  });

  test("on end with no cached channel, the fallback warns", async () => {
    const { command, logger } = createCommand(port);
    const panel = startPanel(command);
    panel.editReply.mockImplementation(async () => {
      throw new Error("Invalid Webhook Token");
    });
    (panel.interaction as unknown as { channel: null }).channel = null;

    await panel.run();
    await expect(panel.end()).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), guildId: GUILD_ID }),
      expect.any(String),
    );
  });

  test("a failed apply during a toggle is logged, not rethrown", async () => {
    const { command, apply, logger } = createCommand(port);
    apply.mockImplementation(async () => {
      throw new Error("db down");
    });
    const panel = startPanel(command);
    const button = createButton(panel, settingsIds.toggle("scam"));

    await panel.run();
    await expect(panel.collect(button.interaction)).resolves.toBeUndefined();

    expect(button.editReply).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        customId: settingsIds.toggle("scam"),
      }),
      expect.any(String),
    );
    expect(button.followUp).toHaveBeenCalledTimes(1);
    const followUp = button.followUp.mock.calls[0][0];
    expect(followUp.flags).toBe(
      MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    );
    expect(json(followUp)).toContain("Something went wrong");
  });

  test("a failed apply during an edit is logged, not rethrown", async () => {
    const { command, apply, logger } = createCommand(port);
    apply.mockImplementation(async () => {
      throw new Error("db down");
    });
    const panel = startPanel(command);
    const edit = createButton(panel, settingsIds.edit("modlog"));
    const { submission, editReply, followUp } = createSubmission([
      channelSelect("channel", [CH.mod]),
    ]);
    submitWith(edit, submission);

    await panel.run();
    await expect(panel.collect(edit.interaction)).resolves.toBeUndefined();

    expect(editReply).not.toHaveBeenCalled();
    expect(followUp).toHaveBeenCalledTimes(1);
    expect(followUp.mock.calls[0][0].flags).toBe(
      MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    );
    expect(edit.followUp).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        customId: settingsIds.edit("modlog"),
      }),
      expect.any(String),
    );
  });

  test("a failed error follow-up is logged at warn", async () => {
    const { command, apply, logger } = createCommand(port);
    apply.mockImplementation(async () => {
      throw new Error("db down");
    });
    const panel = startPanel(command);
    const button = createButton(panel, settingsIds.toggle("scam"));
    button.followUp.mockImplementation(async () => {
      throw new Error("Unknown Webhook");
    });

    await panel.run();
    await expect(panel.collect(button.interaction)).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.any(String),
    );
  });

  test("Edit opens the modal without reading anything first", async () => {
    const { command, getGuildSettings, setIgnoredChannels } =
      createCommand(port);
    const panel = startPanel(command);
    const edit = createButton(panel, settingsIds.edit("modlog"));
    let readsAtShowModal = -1;
    edit.showModal.mockImplementation(async () => {
      readsAtShowModal =
        getGuildSettings.mock.calls.length +
        port.getForSettings.mock.calls.length;
    });
    edit.awaitModalSubmit.mockImplementation(async () => {
      throw new DiscordjsErrorCtor(
        DiscordjsErrorCodes.InteractionCollectorError,
        "time",
      );
    });

    await panel.run();
    const readsAfterRender =
      getGuildSettings.mock.calls.length +
      port.getForSettings.mock.calls.length;
    await panel.collect(edit.interaction);

    expect(readsAtShowModal).toBe(readsAfterRender);
    expect(setIgnoredChannels).not.toHaveBeenCalled();
  });

  test("a second click on the same toggle while it's saving is ignored", async () => {
    const { command, apply } = createCommand(port);
    let release: () => void = () => undefined;
    apply.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(GuildConfig.createDefault(GUILD_ID));
        }),
    );
    const panel = startPanel(command);
    const first = createButton(panel, settingsIds.toggle("spam"));
    const second = createButton(panel, settingsIds.toggle("spam"));

    await panel.run();
    const firstClick = panel.collect(first.interaction);
    await sleep(0);
    await panel.collect(second.interaction);
    release();
    await firstClick;

    expect(apply).toHaveBeenCalledTimes(1);
    expect(second.deferUpdate).toHaveBeenCalledTimes(1);
    expect(second.editReply).not.toHaveBeenCalled();
    expectDeferredThenEdited(first.deferUpdate, first.editReply);
  });
});
