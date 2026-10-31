import type { Guild } from "discord.js";
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { ServerNameHistoryRepository } from "../domain/ServerNameHistory";
import type { ServerImageKind } from "../domain/serverImage";

const PREVIOUS_IMAGE_FETCH_TIMEOUT_MS = 10_000;
const NAME_SUGGESTION_LIMIT = 25;
// Discord's documented default per-file upload limit for the reply attachment.
const MAX_REPLY_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export interface Executor {
  id: string;
  auditReason: string;
}

export interface PreviousImage {
  url: string;
  /** null when the image is too large to attach to the reply. */
  file: { data: Buffer; filename: string } | null;
}

export interface ServerImageChange {
  /** null when the server had no image of this kind. */
  previous: PreviousImage | null;
  currentUrl: string | null;
}

export type ServerImageRejection =
  /** limitBytes is parsed from Discord's error when it states one. */
  | { reason: "too_large"; limitBytes: number | null }
  | { reason: "invalid_image" };

export class ServerAppearanceService {
  constructor(
    private readonly nameHistoryRepository: ServerNameHistoryRepository,
    private readonly logger: Logger,
  ) {}

  async setImage(
    guild: Guild,
    kind: ServerImageKind,
    imageUrl: string,
    executor: Executor,
  ): Promise<Result<ServerImageChange, ServerImageRejection>> {
    // Fetched before the change so the reply can hand mods the original to restore by hand.
    const previous = await this.fetchCurrentImage(guild, kind);

    let updated: Guild;
    try {
      updated =
        kind === "icon"
          ? await guild.setIcon(imageUrl, executor.auditReason)
          : await guild.setBanner(imageUrl, executor.auditReason);
    } catch (err) {
      const rejection = classifyImageRejection(err);
      if (!rejection) {
        throw err;
      }

      this.logger.info(
        {
          guildId: guild.id,
          kind,
          rejection: rejection.reason,
          discordErrors: (err as DiscordAPIError).rawError,
        },
        "Discord rejected server image",
      );
      return Err(rejection);
    }

    this.logger.info(
      { guildId: guild.id, kind, executorId: executor.id },
      "Updated server image",
    );

    return Ok({ previous, currentUrl: serverImageUrl(updated, kind) });
  }

  async rename(
    guild: Guild,
    name: string,
    executor: Executor,
  ): Promise<string> {
    const previousName = guild.name;
    await guild.setName(name, executor.auditReason);

    this.logger.info(
      { guildId: guild.id, executorId: executor.id },
      "Renamed server",
    );

    return previousName;
  }

  async recordNameChange(
    guildId: string,
    oldName: string,
    newName: string,
  ): Promise<void> {
    await this.nameHistoryRepository.record(guildId, [oldName, newName]);
  }

  async suggestNames(guild: Guild, query: string): Promise<string[]> {
    return this.nameHistoryRepository.search(
      guild.id,
      query.trim(),
      guild.name,
      NAME_SUGGESTION_LIMIT,
    );
  }

  private async fetchCurrentImage(
    guild: Guild,
    kind: ServerImageKind,
  ): Promise<PreviousImage | null> {
    const url = serverImageUrl(guild, kind);
    if (!url) {
      return null;
    }

    const response = await fetch(url, {
      signal: AbortSignal.timeout(PREVIOUS_IMAGE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error("Failed to fetch current server image", {
        cause: { status: response.status, guildId: guild.id, kind },
      });
    }

    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > MAX_REPLY_ATTACHMENT_BYTES) {
      return { url, file: null };
    }

    const extension = url.includes("animated=true") ? "webp" : "png";
    return { url, file: { data, filename: `previous-${kind}.${extension}` } };
  }
}

function serverImageUrl(guild: Guild, kind: ServerImageKind): string | null {
  const hash = kind === "icon" ? guild.icon : guild.banner;
  if (!hash) {
    return null;
  }

  // Animated uploads may be WebP, which doesn't convert cleanly to GIF.
  const animated = hash.startsWith("a_");
  const options = {
    size: 4096,
    extension: animated ? "webp" : "png",
    forceStatic: true,
  } as const;
  const url =
    kind === "icon" ? guild.iconURL(options) : guild.bannerURL(options);
  if (!url) {
    return null;
  }

  return animated ? `${url}&animated=true` : url;
}

function classifyImageRejection(err: unknown): ServerImageRejection | null {
  if (!(err instanceof DiscordAPIError)) {
    return null;
  }

  if (err.code === RESTJSONErrorCodes.RequestEntityTooLarge) {
    return { reason: "too_large", limitBytes: null };
  }

  if (err.code !== RESTJSONErrorCodes.InvalidFormBodyOrContentType) {
    return null;
  }

  // Field errors look like { icon: { _errors: [{ code: "BINARY_TYPE_MAX_SIZE", message: "File cannot be larger than 10240.0 kb." }] } }.
  const fieldErrors = JSON.stringify(
    (err.rawError as { errors?: unknown }).errors ?? {},
  );
  if (!/MAX_SIZE|TOO_LARGE/.test(fieldErrors)) {
    return { reason: "invalid_image" };
  }

  const limitKb = /larger than ([\d.]+)\s*kb/i.exec(fieldErrors)?.[1];
  return {
    reason: "too_large",
    limitBytes: limitKb ? Math.round(Number(limitKb) * 1024) : null,
  };
}
