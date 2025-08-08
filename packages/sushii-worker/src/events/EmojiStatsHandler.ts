import opentelemetry from "@opentelemetry/api";
import type {
  Client,
  Events,
  GuildEmoji,
  Message,
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
  Sticker,
  User,
} from "discord.js";
import type { InsertObject } from "kysely/dist/cjs/parser/insert-values-parser";

import dayjs from "@/shared/domain/dayjs";
import { newModuleLogger } from "@/shared/infrastructure/logger";
import { startCaughtActiveSpan } from "@/shared/infrastructure/tracing";

import db from "../infrastructure/database/db";
import type {
  AppPublicEmojiStickerActionType,
  AppPublicGuildAssetType,
  DB,
} from "../infrastructure/database/dbTypes";
import type { EventHandlerFn } from "./EventHandler";

const logger = newModuleLogger("EmojiStatsHandler");

const tracer = opentelemetry.trace.getTracer("emoji-stats-handler");
export const EMOJI_RE = /<(?<animated>a)?:(?<name>\w+):(?<id>\d{16,21})>/g;
export const UserEmojiRateLimitDuration = dayjs.duration({ hours: 1 });

interface NewExpressionStat {
  guild_id: string;
  asset_id: string;
  count: number;
}

type NewExpressionStatWithGuild = NewExpressionStat & {
  count_external: number;
};

async function incrementEmojiCounts(
  userId: string,
  actionType: AppPublicEmojiStickerActionType,
  values: NewExpressionStat[],
): Promise<void> {
  return startCaughtActiveSpan(tracer, "incrementEmojiCounts", async () => {
    // Check the guilds the emoji is from
    const knownEmojis = await db
      .selectFrom("app_public.guild_emojis_and_stickers")
      .selectAll()
      .where(
        "id",
        "in",
        values.map((v) => v.asset_id),
      )
      .execute();

    // Exclude the ones that aren't found in db, from a server sushii isn't in
    const foundEmojiIds = new Map(knownEmojis.map((r) => [r.id, r]));

    const valuesKnown: NewExpressionStatWithGuild[] = values
      .filter((v) => foundEmojiIds.has(v.asset_id))
      .map((v) => {
        const guildEmoji = foundEmojiIds.get(v.asset_id);

        if (guildEmoji?.guild_id === v.guild_id) {
          return {
            ...v,
            count_external: 0,
          };
        }

        return {
          ...v,
          // Swap count with external count
          count_external: v.count,
          count: 0,
        };
      });

    // No emojis found that are in the database, shared w sushii
    if (valuesKnown.length === 0) {
      return;
    }

    // Check if user already contributed to metrics in the past hour
    // Does not need to know if this is a sticker or not
    const span = tracer.startSpan("check user emoji stat rate limit");
    const rateLimitedAssets = await db
      .selectFrom("app_public.emoji_sticker_stats_rate_limits")
      .select(["asset_id"])
      // All values are the same user
      .where("user_id", "=", userId)
      .where("action_type", "=", actionType)
      .where(
        "asset_id",
        "in",
        valuesKnown.map((v) => v.asset_id),
      )
      // Within the past hour, ignore any older entries which are deleted later
      .where(
        "last_used",
        ">=",
        dayjs.utc().subtract(UserEmojiRateLimitDuration).toDate(),
      )
      .execute();

    span.end();

    const assetIdSet = new Set<string>(
      rateLimitedAssets.map((ra) => ra.asset_id),
    );

    // Remove the ratelimited users from the valuesKnown
    const eligibleVals = valuesKnown.filter((v) => !assetIdSet.has(v.asset_id));

    if (eligibleVals.length === 0) {
      // No values to insert
      return;
    }

    // Update stats, mix of both internal and external assets
    const span2 = tracer.startSpan("update emoji stats");
    await db
      .insertInto("app_public.emoji_sticker_stats")
      // Add actionType to all values
      .values(eligibleVals.map((v) => ({ ...v, action_type: actionType })))
      .onConflict((oc) =>
        oc.columns(["time", "asset_id", "action_type"]).doUpdateSet({
          count: (eb) =>
            eb(
              "app_public.emoji_sticker_stats.count",
              "+",
              // Increment by the insert value's count
              eb.ref("excluded.count"),
            ),
          count_external: (eb) =>
            eb(
              "app_public.emoji_sticker_stats.count_external",
              "+",
              // Increment by the insert value's count_external
              eb.ref("excluded.count_external"),
            ),
        }),
      )
      .execute();
    span2.end();

    // Insert the assets_id into the rate limit table
    const span3 = tracer.startSpan("update user emoji stats rate limit");
    await db
      .insertInto("app_public.emoji_sticker_stats_rate_limits")
      .values(
        eligibleVals.map((v) => ({
          user_id: userId,
          asset_id: v.asset_id,
          action_type: actionType,
          last_used: dayjs.utc().toDate(),
        })),
      )
      .onConflict((oc) =>
        // Conflict if there is an older entry, as it's not queried to check if user is rate limited.
        // Update the last_used time in the existing entry
        oc.columns(["user_id", "asset_id", "action_type"]).doUpdateSet({
          last_used: dayjs.utc().toDate(),
        }),
      )
      .execute();

    span3.end();
  });
}

export const emojiStatsMsgHandler: EventHandlerFn<
  Events.MessageCreate
> = async (msg: Message): Promise<void> => {
  if (!msg.inGuild()) {
    return;
  }

  return startCaughtActiveSpan(tracer, "emojiStatsMsgHandler", async () => {
    const matches = msg.content.matchAll(EMOJI_RE);

    // Set to ensure unique emoji ids and no duplicates.
    // We don't care about multiple uses per message, just 1 per message per
    // emoji.
    const uniqueEmojiIds = new Set<string>();

    for (const match of matches) {
      uniqueEmojiIds.add(match.groups?.id ?? "");
    }

    const values: NewExpressionStat[] = Array.from(uniqueEmojiIds).map(
      (emojiId) => ({
        guild_id: msg.guild.id,
        asset_id: emojiId,
        count: 1,
      }),
    );

    // Add stickers if any
    if (msg.stickers.size > 0) {
      const stickers: NewExpressionStat[] = msg.stickers.map((s) => ({
        guild_id: msg.guild.id,
        asset_id: s.id,
        count: 1,
      }));

      values.push(...stickers);
    }

    // Check both emoji and sticker don't exist
    if (values.length === 0) {
      return;
    }

    await incrementEmojiCounts(msg.author.id, "message", values);
  });
};

export const emojiStatsReactHandler: EventHandlerFn<
  Events.MessageReactionAdd
> = async (
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> => {
  // DM message
  if (!reaction.message.inGuild()) {
    return;
  }

  // No emoji id, skip, maybe a unicode emoji
  if (!reaction.emoji.id) {
    return;
  }

  await incrementEmojiCounts(user.id, "reaction", [
    {
      guild_id: reaction.message.guild.id,
      asset_id: reaction.emoji.id,
      count: 1,
    },
  ]);
};

export const emojiAndStickerStatsReadyHandler: EventHandlerFn<
  Events.ClientReady
> = async (client: Client<true>): Promise<void> => {
  logger.info(
    {
      guildsCount: client.guilds.cache.size,
    },
    "Saving all guild emojis and stickers to database",
  );

  let emojiCount = 0;
  let stickerCount = 0;

  for (const guild of client.guilds.cache.values()) {
    // Update database with all the emojis and stickers
    const emojis = Array.from(guild.emojis.cache.values());
    const stickers = Array.from(guild.stickers.cache.values());

    emojiCount += emojis.length;
    stickerCount += stickers.length;

    const values: InsertObject<DB, "app_public.guild_emojis_and_stickers">[] =
      emojis.map((e) => ({
        id: e.id,
        guild_id: guild.id,
        name: e.name || "", // Shouldn't be null, but just in case
        type: "emoji",
      }));

    const stickerValues: InsertObject<
      DB,
      "app_public.guild_emojis_and_stickers"
    >[] = stickers.map((s) => ({
      id: s.id,
      guild_id: guild.id,
      name: s.name,
      type: "sticker",
    }));

    // Add stickers
    values.push(...stickerValues);

    // Skip if no emojis or stickers
    if (values.length === 0) {
      continue;
    }

    await db
      .insertInto("app_public.guild_emojis_and_stickers")
      .values(values)
      // Ignore any existing emojis
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
  }

  logger.info(
    `Saved ${emojiCount} emojis and ${stickerCount} stickers to database`,
  );
};

async function addGuildEmojiOrSticker(
  guildId: string,
  assetId: string,
  name: string,
  type: AppPublicGuildAssetType,
): Promise<void> {
  await db
    .insertInto("app_public.guild_emojis_and_stickers")
    .values({
      guild_id: guildId,
      id: assetId,
      name,
      type,
    })
    // When updating asset
    .onConflict((oc) =>
      oc.column("id").doUpdateSet({
        name,
      }),
    )
    .execute();
}

export const emojiAddHandler: EventHandlerFn<Events.GuildEmojiCreate> = async (
  emoji: GuildEmoji,
) => {
  await addGuildEmojiOrSticker(
    emoji.guild.id,
    emoji.id,
    emoji.name || "",
    "emoji",
  );
};

export const emojiUpdateHandler: EventHandlerFn<
  Events.GuildEmojiUpdate
> = async (emoji: GuildEmoji) => {
  await addGuildEmojiOrSticker(
    emoji.guild.id,
    emoji.id,
    emoji.name || "",
    "emoji",
  );
};

export const stickerAddHandler: EventHandlerFn<
  Events.GuildStickerCreate
> = async (sticker: Sticker) => {
  if (sticker.guildId === null) {
    return;
  }

  await addGuildEmojiOrSticker(
    sticker.guildId,
    sticker.id,
    sticker.name,
    "sticker",
  );
};

export const stickerUpdateHandler: EventHandlerFn<
  Events.GuildStickerUpdate
> = async (sticker: Sticker) => {
  if (sticker.guildId === null) {
    return;
  }

  await addGuildEmojiOrSticker(
    sticker.guildId,
    sticker.id,
    sticker.name,
    "sticker",
  );
};

// Ignore emoji/sticker deletes since we want to keep those
