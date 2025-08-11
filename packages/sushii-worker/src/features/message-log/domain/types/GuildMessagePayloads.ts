import type {
  GatewayMessageCreateDispatchData,
  GatewayMessageDeleteBulkDispatchData,
  GatewayMessageDeleteDispatchData,
  GatewayMessageUpdateDispatchData,
} from "discord.js";

/**
 * Helper types that guarantee guild_id is present (not a DM)
 */
export type GuildMessageCreatePayload = GatewayMessageCreateDispatchData & {
  guild_id: string;
};

export type GuildMessageUpdatePayload = GatewayMessageUpdateDispatchData & {
  guild_id: string;
};

export type GuildMessageDeletePayload = GatewayMessageDeleteDispatchData & {
  guild_id: string;
};

export type GuildMessageDeleteBulkPayload =
  GatewayMessageDeleteBulkDispatchData & {
    guild_id: string;
  };
