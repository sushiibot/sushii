import type {
  Client,
  GatewayDispatchEvents,
  GatewayMessageCreateDispatchData,
  GatewayMessageUpdateDispatchData,
} from "discord.js";
import { sql } from "kysely";

import db from "../../infrastructure/database/db";

type EventData =
  | GatewayMessageCreateDispatchData
  | GatewayMessageUpdateDispatchData;

export default async function msgLogCacheHandler(
  client: Client,
  eventType:
    | GatewayDispatchEvents.MessageCreate
    | GatewayDispatchEvents.MessageUpdate,
  event: EventData,
): Promise<void> {
  // Ignore DMS
  if (!event.guild_id) {
    return;
  }

  // TODO: Log external Apps

  // Ignore bots
  if (event.author.bot) {
    return;
  }

  const config = await db
    .selectFrom("app_public.guild_configs")
    .selectAll()
    .where("app_public.guild_configs.id", "=", event.guild_id)
    .executeTakeFirst();

  // No guild config found, ignore
  if (
    !config || // Config not found
    !config.log_msg || // No msg log set
    !config.log_msg_enabled // Msg log disabled
  ) {
    return;
  }

  // Get ignored msg logs
  const channelBlock = await db
    .selectFrom("app_public.msg_log_blocks")
    .selectAll()
    .where("app_public.msg_log_blocks.guild_id", "=", event.guild_id)
    .where("app_public.msg_log_blocks.channel_id", "=", event.channel_id)
    .executeTakeFirst();

  // Only prevent saving if *all* types are blocked. e.g.
  // If edits are not logged, we still want to keep track of edit events for deletes
  if (channelBlock) {
    return;
  }

  const obj = {
    // Only add the properties we need
    author: event.author,
    content: event.content,
    sticker_items: event.sticker_items,
    attachments: event.attachments,
    referenced_message: event.referenced_message,
    // Circular structure somewhere that I cant repro locally
    // member: undefined,
  };

  const eventStr = JSON.stringify(obj);

  // Save message to db
  await db
    .insertInto("app_public.messages")
    .values({
      message_id: BigInt(event.id),
      channel_id: BigInt(event.channel_id),
      guild_id: BigInt(event.guild_id),
      author_id: BigInt(event.author.id),
      content: event.content || "",
      created: event.timestamp,
      msg: sql`${eventStr}`,
    })
    .onConflict((oc) =>
      oc.column("message_id").doUpdateSet({
        content: event.content || "",
        msg: sql`${eventStr}`,
      }),
    )
    .execute();
}
