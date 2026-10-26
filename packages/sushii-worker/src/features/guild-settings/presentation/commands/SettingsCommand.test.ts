import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  ChatInputCommandInteraction,
  MessageComponentInteraction,
} from "discord.js";
import pino from "pino";

import type {
  BotEmojiRepository,
  EmojiMap,
} from "@/features/bot-emojis/domain";
import type {
  ScreeningSettingsPort,
  ScreeningSettingsState,
} from "@/features/member-screening/application/ScreeningSettingsPort";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import { GuildSettingsService } from "../../application/GuildSettingsService";
import { MessageLogBlockService } from "../../application/MessageLogBlockService";
import {
  SETTINGS_CUSTOM_IDS,
  SETTINGS_EMOJI_NAMES,
} from "../views/components/SettingsConstants";
import SettingsCommand from "./SettingsCommand";

const GUILD_ID = "123456789012345678";
const CHANNEL_ID = "234567890123456789";
const USER_ID = "345678901234567890";

const mockEmojis = Object.fromEntries(
  SETTINGS_EMOJI_NAMES.map((name) => [name, `<:${name}:000000000000000000>`]),
) as EmojiMap<typeof SETTINGS_EMOJI_NAMES>;

interface UpdatePayload {
  components: { toJSON(): unknown }[];
}

class FakeScreeningPort implements ScreeningSettingsPort {
  state: ScreeningSettingsState | null = {
    enabled: false,
    logChannelId: null,
    checkAvatars: true,
  };

  getForSettings = mock(async () => this.state);
  setEnabled = mock(async (_guildId: string, enabled: boolean) => {
    if (this.state) {
      this.state = { ...this.state, enabled };
    }
  });
  setLogChannel = mock(async (_guildId: string, channelId: string | null) => {
    if (this.state) {
      this.state = { ...this.state, logChannelId: channelId };
    }
  });
  setCheckAvatars = mock(async (_guildId: string, checkAvatars: boolean) => {
    if (this.state) {
      this.state = { ...this.state, checkAvatars };
    }
  });
}

function createCommand(port: ScreeningSettingsPort | null) {
  const guildSettingsService = Object.create(
    GuildSettingsService.prototype,
  ) as GuildSettingsService;
  guildSettingsService.getGuildSettings = mock(async () =>
    GuildConfig.createDefault(GUILD_ID),
  );
  guildSettingsService.toggleSetting = mock(async () => {
    throw new Error("toggleSetting must not be called for screening ids");
  });

  const messageLogBlockService = Object.create(
    MessageLogBlockService.prototype,
  ) as MessageLogBlockService;
  messageLogBlockService.getIgnoredChannels = mock(async () => []);

  const emojiRepository = {
    getEmojis: mock(async () => mockEmojis),
  } as unknown as BotEmojiRepository;

  return {
    command: new SettingsCommand(
      guildSettingsService,
      messageLogBlockService,
      pino({ level: "silent" }),
      emojiRepository,
      port,
    ),
    guildSettingsService,
  };
}

function createInteraction(
  kind: "button" | "channel",
  customId: string,
  values: string[] = [],
) {
  const update = mock(async (_payload: UpdatePayload) => undefined);
  const interaction = {
    id: "456789012345678901",
    user: { id: USER_ID },
    customId,
    values,
    isChannelSelectMenu: () => kind === "channel",
    isRoleSelectMenu: () => false,
    isButton: () => kind === "button",
    guild: {
      channels: { cache: { get: () => undefined } },
      members: { me: null },
    },
    update,
  } as unknown as MessageComponentInteraction<"cached">;

  return { interaction, update };
}

function handle(
  command: SettingsCommand,
  interaction: MessageComponentInteraction<"cached">,
) {
  return command["handleComponentInteraction"](interaction, GUILD_ID);
}

function renderedJson(update: ReturnType<typeof createInteraction>["update"]) {
  expect(update).toHaveBeenCalledTimes(1);
  const payload = update.mock.calls[0][0];
  return JSON.stringify(payload.components.map((c) => c.toJSON()));
}

describe("SettingsCommand member screening routing", () => {
  let port: FakeScreeningPort;

  beforeEach(() => {
    port = new FakeScreeningPort();
  });

  test("screening toggle flips enabled and re-renders automod", async () => {
    const { command, guildSettingsService } = createCommand(port);
    const { interaction, update } = createInteraction(
      "button",
      SETTINGS_CUSTOM_IDS.SCREENING.TOGGLE,
    );

    const page = await handle(command, interaction);

    expect(page).toBe("automod");
    expect(port.setEnabled).toHaveBeenCalledWith(GUILD_ID, true);
    expect(port.getForSettings).toHaveBeenCalledTimes(1);
    expect(port.setCheckAvatars).not.toHaveBeenCalled();
    expect(guildSettingsService.toggleSetting).not.toHaveBeenCalled();
    expect(renderedJson(update)).toContain(
      "-# ⚠️ Pick a log channel to start screening",
    );
  });

  test("avatar toggle flips checkAvatars and re-renders automod", async () => {
    const { command } = createCommand(port);
    const { interaction, update } = createInteraction(
      "button",
      SETTINGS_CUSTOM_IDS.SCREENING.TOGGLE_AVATARS,
    );

    const page = await handle(command, interaction);

    expect(page).toBe("automod");
    expect(port.setCheckAvatars).toHaveBeenCalledWith(GUILD_ID, false);
    expect(port.getForSettings).toHaveBeenCalledTimes(1);
    expect(port.setEnabled).not.toHaveBeenCalled();
    expect(renderedJson(update)).toContain(
      SETTINGS_CUSTOM_IDS.SCREENING.TOGGLE_AVATARS,
    );
  });

  test("channel select sets the log channel and re-renders automod", async () => {
    port.state = { enabled: true, logChannelId: null, checkAvatars: true };
    const { command } = createCommand(port);
    const { interaction, update } = createInteraction(
      "channel",
      SETTINGS_CUSTOM_IDS.SCREENING.SET_CHANNEL,
      [CHANNEL_ID],
    );

    const page = await handle(command, interaction);

    expect(page).toBe("automod");
    expect(port.setLogChannel).toHaveBeenCalledWith(GUILD_ID, CHANNEL_ID);
    expect(port.getForSettings).toHaveBeenCalledTimes(1);
    const json = renderedJson(update);
    expect(json).toContain(`-# ✅ On · posting to <#${CHANNEL_ID}>`);
    expect(json).toContain("Missing permissions");
  });

  test("clearing the channel select sets the log channel to null", async () => {
    port.state = {
      enabled: true,
      logChannelId: CHANNEL_ID,
      checkAvatars: true,
    };
    const { command } = createCommand(port);
    const { interaction } = createInteraction(
      "channel",
      SETTINGS_CUSTOM_IDS.SCREENING.SET_CHANNEL,
      [],
    );

    await handle(command, interaction);

    expect(port.setLogChannel).toHaveBeenCalledWith(GUILD_ID, null);
  });

  const cases = [
    ["button", SETTINGS_CUSTOM_IDS.SCREENING.TOGGLE],
    ["button", SETTINGS_CUSTOM_IDS.SCREENING.TOGGLE_AVATARS],
    ["channel", SETTINGS_CUSTOM_IDS.SCREENING.SET_CHANNEL],
  ] as const;

  for (const [kind, customId] of cases) {
    test(`${customId} is ignored when the flag was turned off meanwhile`, async () => {
      port.state = null;
      const { command } = createCommand(port);
      const { interaction, update } = createInteraction(kind, customId, [
        CHANNEL_ID,
      ]);

      const page = await handle(command, interaction);

      expect(page).toBe("automod");
      expect(port.setEnabled).not.toHaveBeenCalled();
      expect(port.setLogChannel).not.toHaveBeenCalled();
      expect(port.setCheckAvatars).not.toHaveBeenCalled();
      const json = renderedJson(update);
      expect(json).toContain("Exempt Roles");
      expect(json).not.toContain("Member Screening");
    });

    test(`${customId} re-renders without the section when there is no port`, async () => {
      const { command } = createCommand(null);
      const { interaction, update } = createInteraction(kind, customId, [
        CHANNEL_ID,
      ]);

      const page = await handle(command, interaction);

      expect(page).toBe("automod");
      expect(renderedJson(update)).not.toContain("Member Screening");
    });
  }

  test("opening the automod tab loads screening state from the port", async () => {
    port.state = {
      enabled: true,
      logChannelId: CHANNEL_ID,
      checkAvatars: true,
    };
    const { command } = createCommand(port);
    const { interaction, update } = createInteraction(
      "button",
      SETTINGS_CUSTOM_IDS.NAVIGATION.TAB_AUTOMOD,
    );

    await handle(command, interaction);

    expect(port.getForSettings).toHaveBeenCalledWith(GUILD_ID);
    expect(renderedJson(update)).toContain(
      `-# ✅ On · posting to <#${CHANNEL_ID}>`,
    );
  });

  test("a failed screening load renders automod without the section", async () => {
    port.getForSettings.mockImplementation(async () => {
      throw new Error("feature flags not loaded");
    });
    const { command } = createCommand(port);
    const { interaction, update } = createInteraction(
      "button",
      SETTINGS_CUSTOM_IDS.NAVIGATION.TAB_AUTOMOD,
    );

    const page = await handle(command, interaction);

    expect(page).toBe("automod");
    const json = renderedJson(update);
    expect(json).toContain("Spam Detection");
    expect(json).not.toContain("Member Screening");
  });
});

function startPanel(command: SettingsCommand) {
  const handlers: Record<string, (...args: unknown[]) => Promise<void>> = {};
  const collector = {
    on: (event: string, fn: (...args: unknown[]) => Promise<void>) => {
      handlers[event] = fn;
      return collector;
    },
  };
  const edit = mock(async (_payload: UpdatePayload) => undefined);
  const reply = mock(async (_payload: UpdatePayload) => ({
    createMessageComponentCollector: () => collector,
    edit,
  }));
  const interaction = {
    inCachedGuild: () => true,
    guildId: GUILD_ID,
    user: { id: USER_ID },
    guild: {
      channels: { cache: { get: () => undefined } },
      members: { me: null },
    },
    reply,
  } as unknown as ChatInputCommandInteraction;

  return {
    run: () => command.handler(interaction),
    collect: (i: MessageComponentInteraction<"cached">) => handlers.collect(i),
    end: () => handlers.end(),
    reply,
    edit,
  };
}

function payloadJson(payload: UpdatePayload): string {
  return JSON.stringify(payload.components.map((c) => c.toJSON()));
}

describe("SettingsCommand screening loading per page", () => {
  let port: FakeScreeningPort;

  beforeEach(() => {
    port = new FakeScreeningPort();
    port.state = {
      enabled: true,
      logChannelId: CHANNEL_ID,
      checkAvatars: true,
    };
  });

  test("initial overview reply and its expired edit don't call the port", async () => {
    const panel = startPanel(createCommand(port).command);

    await panel.run();
    await panel.end();

    expect(port.getForSettings).not.toHaveBeenCalled();
    expect(payloadJson(panel.reply.mock.calls[0][0])).not.toContain(
      "Member Screening",
    );
    expect(payloadJson(panel.edit.mock.calls[0][0])).not.toContain(
      "Member Screening",
    );
  });

  test("a non-automod tab doesn't call the port", async () => {
    const panel = startPanel(createCommand(port).command);
    const { interaction } = createInteraction(
      "button",
      SETTINGS_CUSTOM_IDS.NAVIGATION.TAB_LOGGING,
    );

    await panel.run();
    await panel.collect(interaction);
    await panel.end();

    expect(port.getForSettings).not.toHaveBeenCalled();
  });

  test("expired edit on the automod page loads and passes screening through", async () => {
    const panel = startPanel(createCommand(port).command);
    const { interaction, update } = createInteraction(
      "button",
      SETTINGS_CUSTOM_IDS.NAVIGATION.TAB_AUTOMOD,
    );

    await panel.run();
    await panel.collect(interaction);
    expect(port.getForSettings).toHaveBeenCalledTimes(1);
    expect(payloadJson(update.mock.calls[0][0])).toContain(
      `-# ✅ On · posting to <#${CHANNEL_ID}>`,
    );

    await panel.end();

    expect(port.getForSettings).toHaveBeenCalledTimes(2);
    expect(port.getForSettings).toHaveBeenLastCalledWith(GUILD_ID);
    const expired = payloadJson(panel.edit.mock.calls[0][0]);
    expect(expired).toContain(`-# ✅ On · posting to <#${CHANNEL_ID}>`);
    expect(expired).toContain("Missing permissions");
  });
});
