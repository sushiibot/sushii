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

import type { ServerNameHistoryRepository } from "../domain/ServerNameHistory";
import { MAX_SERVER_IMAGE_BYTES } from "../domain/serverImage";
import type { ServerImageRejection } from "./ServerAppearanceService";
import { ServerAppearanceService } from "./ServerAppearanceService";

const GUILD_ID = "111111111111111111";
const MOD_ID = "222222222222222222";
const EXECUTOR = { id: MOD_ID, auditReason: "tzuyu via /server icon" };
const NEW_IMAGE_URL = "https://cdn.discordapp.com/attachments/1/2/bday.png";

function apiError(code: number, errors?: unknown): DiscordAPIError {
  const err = Object.create(DiscordAPIError.prototype) as DiscordAPIError;
  Object.assign(err, {
    code,
    rawError: { code, message: "Invalid Form Body", errors },
  });
  return err;
}

function createRepository() {
  return {
    record: mock(() => Promise.resolve()),
    search: mock(async () => ["TWICE Fans"]),
  } satisfies ServerNameHistoryRepository;
}

function createGuild(fields: {
  name?: string;
  icon?: string | null;
  banner?: string | null;
}) {
  const url =
    (route: string, hash: string | null) =>
    ({ extension, size }: { extension: string; size: number }) =>
      hash ? `https://cdn/${route}/${hash}.${extension}?size=${size}` : null;

  const guild = {
    id: GUILD_ID,
    name: fields.name ?? "TWICE Fans",
    icon: fields.icon ?? null,
    banner: fields.banner ?? null,
    iconURL: (o: { extension: string; size: number }) =>
      url("icons", guild.icon)(o),
    bannerURL: (o: { extension: string; size: number }) =>
      url("banners", guild.banner)(o),
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

      const change = (
        await service.setImage(asGuild(guild), "icon", NEW_IMAGE_URL, EXECUTOR)
      ).unwrap();

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://cdn/icons/oldhash.png?size=4096",
        expect.anything(),
      );
      expect(change.previous?.file?.filename).toBe("previous-icon.png");
      expect(change.previous?.file?.data).toEqual(Buffer.from([1, 2, 3]));
      expect(change.currentUrl).toBe("https://cdn/icons/newhash.png?size=4096");
      expect(guild.setIcon).toHaveBeenCalledWith(
        NEW_IMAGE_URL,
        EXECUTOR.auditReason,
      );
    });

    test("fetches an animated icon as animated WebP", async () => {
      const guild = createGuild({ icon: "a_oldhash" });
      const service = new ServerAppearanceService(createRepository(), logger);

      const change = (
        await service.setImage(asGuild(guild), "icon", NEW_IMAGE_URL, EXECUTOR)
      ).unwrap();

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://cdn/icons/a_oldhash.webp?size=4096&animated=true",
        expect.anything(),
      );
      expect(change.previous?.file?.filename).toBe("previous-icon.webp");
    });

    test("has no previous image when the server had no banner", async () => {
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

    test("links instead of attaching a previous image over the upload limit", async () => {
      fetchSpy.mockImplementation(
        (async () =>
          new Response(
            new Uint8Array(MAX_SERVER_IMAGE_BYTES + 1),
          )) as unknown as typeof fetch,
      );
      const guild = createGuild({ banner: "bigbanner" });
      const service = new ServerAppearanceService(createRepository(), logger);

      const change = (
        await service.setImage(
          asGuild(guild),
          "banner",
          NEW_IMAGE_URL,
          EXECUTOR,
        )
      ).unwrap();

      expect(change.previous).toEqual({
        url: "https://cdn/banners/bigbanner.png?size=4096",
        file: null,
      });
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

    test.each<[string, DiscordAPIError, ServerImageRejection]>([
      [
        "a max-size field error",
        apiError(RESTJSONErrorCodes.InvalidFormBodyOrContentType, {
          icon: {
            _errors: [
              {
                code: "BINARY_TYPE_MAX_SIZE",
                message: "File cannot be larger than 10240.0 kb.",
              },
            ],
          },
        }),
        "too_large",
      ],
      [
        "request entity too large",
        apiError(RESTJSONErrorCodes.RequestEntityTooLarge),
        "too_large",
      ],
      [
        "any other form body error",
        apiError(RESTJSONErrorCodes.InvalidFormBodyOrContentType, {
          icon: {
            _errors: [{ code: "IMAGE_INVALID", message: "Invalid image data" }],
          },
        }),
        "invalid_image",
      ],
    ])("maps %s to %s", async (_label, error, expected) => {
      const guild = createGuild({});
      guild.setIcon.mockImplementation(async () => {
        throw error;
      });
      const service = new ServerAppearanceService(createRepository(), logger);

      const result = await service.setImage(
        asGuild(guild),
        "icon",
        NEW_IMAGE_URL,
        EXECUTOR,
      );

      expect(result.err && result.val).toBe(expected);
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

  describe("names", () => {
    test("rename returns the previous name", async () => {
      const guild = createGuild({ name: "TWICE Fans" });
      const service = new ServerAppearanceService(createRepository(), logger);

      const previous = await service.rename(
        asGuild(guild),
        "TWICE Fans 🎂 Nayeon",
        EXECUTOR,
      );

      expect(previous).toBe("TWICE Fans");
      expect(guild.setName).toHaveBeenCalledWith(
        "TWICE Fans 🎂 Nayeon",
        EXECUTOR.auditReason,
      );
    });

    test("records both the old and the new name", async () => {
      const repository = createRepository();
      const service = new ServerAppearanceService(repository, logger);

      await service.recordNameChange(GUILD_ID, "TWICE Fans", "TWICE Fans 🎂");

      expect(repository.record).toHaveBeenCalledWith(GUILD_ID, [
        "TWICE Fans",
        "TWICE Fans 🎂",
      ]);
    });

    test("suggestions exclude the current name and trim the query", async () => {
      const guild = createGuild({ name: "TWICE Fans 🎂 Nayeon" });
      const repository = createRepository();
      const service = new ServerAppearanceService(repository, logger);

      await service.suggestNames(asGuild(guild), "  twice ");

      expect(repository.search).toHaveBeenCalledWith(
        GUILD_ID,
        "twice",
        "TWICE Fans 🎂 Nayeon",
        25,
      );
    });
  });
});
