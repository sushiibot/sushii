import type { Guild } from "discord.js";
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type {
  ServerNameSnapshot,
  ServerNameSnapshotRepository,
} from "../domain/ServerNameSnapshot";
import type { ServerImageKind } from "../domain/serverImage";
import { MAX_SERVER_IMAGE_BYTES } from "../domain/serverImage";

const PREVIOUS_IMAGE_FETCH_TIMEOUT_MS = 10_000;

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

export interface ServerRename {
  previousName: string;
  /** What /server restore-name would set; null only if the snapshot was removed concurrently. */
  snapshot: ServerNameSnapshot | null;
}

export interface ServerNameRestore {
  previousName: string;
  snapshot: ServerNameSnapshot;
}

export class ServerAppearanceService {
  constructor(
    private readonly snapshotRepository: ServerNameSnapshotRepository,
    private readonly logger: Logger,
  ) {}

  async setImage(
    guild: Guild,
    kind: ServerImageKind,
    imageUrl: string,
    executor: Executor,
  ): Promise<Result<ServerImageChange, "invalid_image">> {
    // Fetched before the change so the reply can hand mods the original to restore by hand.
    const previous = await this.fetchCurrentImage(guild, kind);

    let updated: Guild;
    try {
      updated =
        kind === "icon"
          ? await guild.setIcon(imageUrl, executor.auditReason)
          : await guild.setBanner(imageUrl, executor.auditReason);
    } catch (err) {
      if (isRejectedImage(err)) {
        this.logger.info(
          { err, guildId: guild.id, kind },
          "Discord rejected server image",
        );
        return Err("invalid_image");
      }

      throw err;
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
  ): Promise<ServerRename> {
    const previousName = guild.name;

    await this.snapshotRepository.saveIfAbsent({
      guildId: guild.id,
      name: previousName,
      savedBy: executor.id,
    });
    await guild.setName(name, executor.auditReason);

    this.logger.info(
      { guildId: guild.id, executorId: executor.id },
      "Renamed server",
    );

    return {
      previousName,
      snapshot: await this.snapshotRepository.findByGuild(guild.id),
    };
  }

  async restoreName(
    guild: Guild,
    executor: Executor,
  ): Promise<Result<ServerNameRestore, "nothing_saved">> {
    const snapshot = await this.snapshotRepository.findByGuild(guild.id);
    if (!snapshot) {
      return Err("nothing_saved");
    }

    const previousName = guild.name;
    await guild.setName(snapshot.name, executor.auditReason);
    await this.snapshotRepository.deleteByGuild(guild.id);

    this.logger.info(
      { guildId: guild.id, executorId: executor.id },
      "Restored server name",
    );

    return Ok({ previousName, snapshot });
  }

  private async fetchCurrentImage(
    guild: Guild,
    kind: ServerImageKind,
  ): Promise<PreviousImage | null> {
    const hash = kind === "icon" ? guild.icon : guild.banner;
    const url = serverImageUrl(guild, kind);
    if (!hash || !url) {
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
    if (data.length > MAX_SERVER_IMAGE_BYTES) {
      return { url, file: null };
    }

    const extension = hash.startsWith("a_") ? "gif" : "png";
    return { url, file: { data, filename: `previous-${kind}.${extension}` } };
  }
}

// Animated hashes resolve to .gif regardless of the requested extension.
function serverImageUrl(guild: Guild, kind: ServerImageKind): string | null {
  const options = { size: 4096, extension: "png" } as const;
  return kind === "icon" ? guild.iconURL(options) : guild.bannerURL(options);
}

function isRejectedImage(err: unknown): boolean {
  return (
    err instanceof DiscordAPIError &&
    (err.code === RESTJSONErrorCodes.InvalidFormBodyOrContentType ||
      err.code === RESTJSONErrorCodes.RequestEntityTooLarge)
  );
}
