import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import type { Guild } from "discord.js";
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import pino from "pino";

import type {
  ServerNameSnapshot,
  ServerNameSnapshotRepository,
} from "../domain/ServerNameSnapshot";
import { ServerAppearanceService } from "./ServerAppearanceService";

const GUILD_ID = "111111111111111111";
const MOD_ID = "222222222222222222";
const EXECUTOR = { id: MOD_ID, auditReason: "tzuyu via /server icon" };
const NEW_IMAGE_URL = "https://cdn.discordapp.com/attachments/1/2/bday.png";

function apiError(code: number): DiscordAPIError {
  const err = Object.create(DiscordAPIError.prototype) as DiscordAPIError;
  Object.assign(err, { code });
  return err;
}

function createRepository(initial: ServerNameSnapshot | null = null) {
  let stored = initial;
  return {
    findByGuild: mock(async () => stored),
    saveIfAbsent: mock(
      async (snapshot: Omit<ServerNameSnapshot, "savedAt">) => {
        stored ??= { ...snapshot, savedAt: new Date() };
      },
    ),
    deleteByGuild: mock(async () => {
      stored = null;
    }),
  } satisfies ServerNameSnapshotRepository;
}

function createGuild(fields: {
  name?: string;
  icon?: string | null;
  banner?: string | null;
}) {
  const guild = {
    id: GUILD_ID,
    name: fields.name ?? "TWICE Fans",
    icon: fields.icon ?? null,
    banner: fields.banner ?? null,
    iconURL: ({ extension }: { extension: string }) =>
      guild.icon
        ? `https://cdn/icons/${guild.icon}.${guild.icon.startsWith("a_") ? "gif" : extension}`
        : null,
    bannerURL: ({ extension }: { extension: string }) =>
      guild.banner ? `https://cdn/banners/${guild.banner}.${extension}` : null,
    setName: mock(async (name: string) => {
      guild.name = name;
      return guild;
    }),
    setIcon: mock(async () => {
      guild.icon = "newhash";
      return guild;
    }),
    setBanner: mock(async () => {
      guild.banner = "newbanner";
      return guild;
    }),
  };
  return guild;
}

const asGuild = (g: ReturnType<typeof createGuild>) => g as unknown as Guild;

describe("ServerAppearanceService", () => {
  const logger = pino({ level: "silent" });
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      (async () =>
        new Response(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch,
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe("setImage", () => {
    test("returns the previous icon as a file and the new icon URL", async () => {
      const guild = createGuild({ icon: "oldhash" });
      const service = new ServerAppearanceService(createRepository(), logger);

      const result = await service.setImage(
        asGuild(guild),
        "icon",
        NEW_IMAGE_URL,
        EXECUTOR,
      );

      const change = result.unwrap();
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://cdn/icons/oldhash.png",
        expect.anything(),
      );
      expect(change.previous?.filename).toBe("previous-icon.png");
      expect(change.previous?.data).toEqual(Buffer.from([1, 2, 3]));
      expect(change.currentUrl).toBe("https://cdn/icons/newhash.png");
      expect(guild.setIcon).toHaveBeenCalledWith(
        NEW_IMAGE_URL,
        EXECUTOR.auditReason,
      );
    });

    test("keeps an animated icon animated", async () => {
      const guild = createGuild({ icon: "a_oldhash" });
      const service = new ServerAppearanceService(createRepository(), logger);

      const change = (
        await service.setImage(asGuild(guild), "icon", NEW_IMAGE_URL, EXECUTOR)
      ).unwrap();

      expect(change.previous?.filename).toBe("previous-icon.gif");
    });

    test("has no previous file when the server had no banner", async () => {
      const guild = createGuild({ banner: null });
      const service = new ServerAppearanceService(createRepository(), logger);

      const change = (
        await service.setImage(
          asGuild(guild),
          "banner",
          NEW_IMAGE_URL,
          EXECUTOR,
        )
      ).unwrap();

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(change.previous).toBeNull();
      expect(guild.setBanner).toHaveBeenCalled();
      expect(guild.setIcon).not.toHaveBeenCalled();
    });

    test("doesn't change anything when the current image can't be fetched", async () => {
      fetchSpy.mockImplementation(
        (async () =>
          new Response(null, { status: 404 })) as unknown as typeof fetch,
      );
      const guild = createGuild({ icon: "oldhash" });
      const service = new ServerAppearanceService(createRepository(), logger);

      await expect(
        service.setImage(asGuild(guild), "icon", NEW_IMAGE_URL, EXECUTOR),
      ).rejects.toThrow("Failed to fetch current server image");
      expect(guild.setIcon).not.toHaveBeenCalled();
    });

    test("returns invalid_image when Discord rejects the file", async () => {
      const guild = createGuild({});
      guild.setIcon.mockImplementation(async () => {
        throw apiError(RESTJSONErrorCodes.InvalidFormBodyOrContentType);
      });
      const service = new ServerAppearanceService(createRepository(), logger);

      const result = await service.setImage(
        asGuild(guild),
        "icon",
        NEW_IMAGE_URL,
        EXECUTOR,
      );

      expect(result.err && result.val).toBe("invalid_image");
    });

    test("rethrows other Discord errors", async () => {
      const guild = createGuild({});
      guild.setIcon.mockImplementation(async () => {
        throw apiError(RESTJSONErrorCodes.MissingPermissions);
      });
      const service = new ServerAppearanceService(createRepository(), logger);

      await expect(
        service.setImage(asGuild(guild), "icon", NEW_IMAGE_URL, EXECUTOR),
      ).rejects.toBeInstanceOf(DiscordAPIError);
    });
  });

  describe("rename", () => {
    test("saves the current name before renaming", async () => {
      const guild = createGuild({ name: "TWICE Fans" });
      const repository = createRepository();
      const service = new ServerAppearanceService(repository, logger);

      const rename = await service.rename(
        asGuild(guild),
        "TWICE Fans 🎂 Nayeon",
        EXECUTOR,
      );

      expect(repository.saveIfAbsent).toHaveBeenCalledWith({
        guildId: GUILD_ID,
        name: "TWICE Fans",
        savedBy: MOD_ID,
      });
      expect(guild.setName).toHaveBeenCalledWith(
        "TWICE Fans 🎂 Nayeon",
        EXECUTOR.auditReason,
      );
      expect(rename.previousName).toBe("TWICE Fans");
      expect(rename.snapshot?.name).toBe("TWICE Fans");
    });

    test("a second rename still restores to the original name", async () => {
      const guild = createGuild({ name: "TWICE Fans" });
      const service = new ServerAppearanceService(createRepository(), logger);

      await service.rename(asGuild(guild), "TWICE Fans 🎂 Nayeon", EXECUTOR);
      const second = await service.rename(
        asGuild(guild),
        "TWICE Fans 🎂 Jeongyeon",
        EXECUTOR,
      );

      expect(second.previousName).toBe("TWICE Fans 🎂 Nayeon");
      expect(second.snapshot?.name).toBe("TWICE Fans");
    });
  });

  describe("restoreName", () => {
    test("returns nothing_saved without a snapshot", async () => {
      const guild = createGuild({});
      const service = new ServerAppearanceService(createRepository(), logger);

      const result = await service.restoreName(asGuild(guild), EXECUTOR);

      expect(result.err && result.val).toBe("nothing_saved");
      expect(guild.setName).not.toHaveBeenCalled();
    });

    test("restores the saved name and clears the snapshot", async () => {
      const guild = createGuild({ name: "TWICE Fans 🎂 Nayeon" });
      const repository = createRepository({
        guildId: GUILD_ID,
        name: "TWICE Fans",
        savedBy: MOD_ID,
        savedAt: new Date("2026-10-29T00:00:00Z"),
      });
      const service = new ServerAppearanceService(repository, logger);

      const restore = (
        await service.restoreName(asGuild(guild), EXECUTOR)
      ).unwrap();

      expect(guild.setName).toHaveBeenCalledWith(
        "TWICE Fans",
        EXECUTOR.auditReason,
      );
      expect(repository.deleteByGuild).toHaveBeenCalledWith(GUILD_ID);
      expect(restore.previousName).toBe("TWICE Fans 🎂 Nayeon");
      expect(restore.snapshot.name).toBe("TWICE Fans");
    });
  });
});
