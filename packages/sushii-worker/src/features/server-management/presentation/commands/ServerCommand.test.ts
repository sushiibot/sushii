import { describe, expect, mock, test } from "bun:test";
import type { ChatInputCommandInteraction } from "discord.js";
import { GuildFeature, MessageFlags } from "discord.js";
import pino from "pino";
import { Err, Ok } from "ts-results";

import type { PermissionUsageRecorder } from "@/features/permission-audit";
import { fallbackMention } from "@/shared/presentation/commandMentions";

import type { ServerAppearanceService } from "../../application/ServerAppearanceService";
import { ServerCommand } from "./ServerCommand";

const GUILD_ID = "111111111111111111";
const MOD_ID = "222222222222222222";

interface Options {
  subcommand?: string;
  attachment?: { url: string; contentType: string | null; size: number };
  name?: string;
  botCanManage?: boolean;
  features?: string[];
}

function createInteraction(options: Options = {}) {
  const interaction = {
    guildId: GUILD_ID,
    user: { id: MOD_ID, username: "tzuyu" },
    guild: {
      id: GUILD_ID,
      name: "TWICE Fans",
      features: options.features ?? [],
      members: {
        me: {
          permissions: { has: () => options.botCanManage ?? true },
        },
      },
    },
    inCachedGuild: () => true,
    options: {
      getSubcommand: () => options.subcommand ?? "icon",
      getAttachment: () =>
        options.attachment ?? {
          url: "https://cdn/attachments/bday.png",
          contentType: "image/png",
          size: 200_000,
        },
      getString: () => options.name ?? "TWICE Fans 🎂",
    },
    reply: mock(() => Promise.resolve()),
    deferReply: mock(() => Promise.resolve()),
    editReply: mock(() => Promise.resolve()),
    deleteReply: mock(() => Promise.resolve()),
    followUp: mock(() => Promise.resolve()),
  };
  return interaction;
}

function createCommand(service: Partial<ServerAppearanceService> = {}) {
  const appearanceService = {
    setImage: mock(async () =>
      Ok({ previous: null, currentUrl: "https://cdn/icons/new.png" }),
    ),
    rename: mock(async () => "TWICE Fans"),
    ...service,
  } as unknown as ServerAppearanceService;
  const recorder = {
    recordSushiiAction: mock(() => Promise.resolve()),
  } as unknown as PermissionUsageRecorder;

  return {
    command: new ServerCommand(
      appearanceService,
      recorder,
      { mention: fallbackMention },
      pino({ level: "silent" }),
    ),
    appearanceService,
    recorder,
  };
}

async function run(
  command: ServerCommand,
  interaction: ReturnType<typeof createInteraction>,
) {
  await command.handler(interaction as unknown as ChatInputCommandInteraction);
}

function sentText(mockFn: ReturnType<typeof mock>): string {
  return JSON.stringify(
    (
      mockFn.mock.calls[0][0] as { components: { toJSON(): unknown }[] }
    ).components.map((c) => c.toJSON()),
  );
}

function sentFlags(mockFn: ReturnType<typeof mock>): number {
  return (mockFn.mock.calls[0][0] as { flags: number }).flags;
}

const EPHEMERAL_V2 = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

describe("ServerCommand", () => {
  test("leaves oversized or unusual files for Discord to judge", async () => {
    const { command, appearanceService } = createCommand();
    const interaction = createInteraction({
      attachment: {
        url: "https://cdn/attachments/huge.webp",
        contentType: "image/webp",
        size: 14.2 * 1024 * 1024,
      },
    });

    await run(command, interaction);

    expect(interaction.deferReply).toHaveBeenCalled();
    expect(appearanceService.setImage).toHaveBeenCalled();
  });

  test("rejects a banner on a server without banners", async () => {
    const { command, appearanceService } = createCommand();
    const interaction = createInteraction({ subcommand: "banner" });

    await run(command, interaction);

    expect(appearanceService.setImage).not.toHaveBeenCalled();
    expect(sentFlags(interaction.reply)).toBe(EPHEMERAL_V2);
    expect(sentText(interaction.reply)).toContain("boost level 2");
  });

  test("checks the bot's own permission first", async () => {
    const { command, appearanceService } = createCommand();
    const interaction = createInteraction({
      subcommand: "name",
      botCanManage: false,
    });

    await run(command, interaction);

    expect(appearanceService.rename).not.toHaveBeenCalled();
    expect(sentFlags(interaction.reply)).toBe(EPHEMERAL_V2);
    expect(sentText(interaction.reply)).toContain("Manage Server");
  });

  test("replaces the public placeholder with a private error when Discord rejects the size", async () => {
    const { command, recorder } = createCommand({
      setImage: mock(async () =>
        Err({ reason: "too_large" as const, limitBytes: 10240 * 1024 }),
      ),
    });
    const interaction = createInteraction({
      subcommand: "banner",
      features: [GuildFeature.Banner],
    });

    await run(command, interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith();
    expect(interaction.deleteReply).toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(recorder.recordSushiiAction).not.toHaveBeenCalled();
    expect(sentFlags(interaction.followUp)).toBe(EPHEMERAL_V2);
    expect(sentText(interaction.followUp)).toContain(
      "That image is 0.2 MB, and Discord's limit for a server banner is 10.0 MB. Resize it to about 960×540",
    );
  });

  test("replaces the public placeholder with a private error for unreadable images", async () => {
    const { command } = createCommand({
      setImage: mock(async () => Err({ reason: "invalid_image" as const })),
    });
    const interaction = createInteraction();

    await run(command, interaction);

    expect(interaction.deleteReply).toHaveBeenCalled();
    expect(sentText(interaction.followUp)).toContain(
      "Discord couldn't read that image",
    );
  });

  test("posts a public confirmation and records the permission use on success", async () => {
    const { command, recorder, appearanceService } = createCommand();
    const interaction = createInteraction();

    await run(command, interaction);

    expect(appearanceService.setImage).toHaveBeenCalledWith(
      interaction.guild,
      "icon",
      "https://cdn/attachments/bday.png",
      { id: MOD_ID, auditReason: "tzuyu via /server icon" },
    );
    expect(sentFlags(interaction.editReply)).toBe(MessageFlags.IsComponentsV2);
    expect(recorder.recordSushiiAction).toHaveBeenCalledWith({
      guildId: GUILD_ID,
      userId: MOD_ID,
      permission: "ManageGuild",
      channelId: null,
    });
  });

  test("renames publicly", async () => {
    const { command, appearanceService } = createCommand();
    const interaction = createInteraction({ subcommand: "name" });

    await run(command, interaction);

    expect(appearanceService.rename).toHaveBeenCalledWith(
      interaction.guild,
      "TWICE Fans 🎂",
      { id: MOD_ID, auditReason: "tzuyu via /server name" },
    );
    expect(sentFlags(interaction.reply)).toBe(MessageFlags.IsComponentsV2);
    expect(sentText(interaction.reply)).toContain("TWICE Fans 🎂");
  });
});
