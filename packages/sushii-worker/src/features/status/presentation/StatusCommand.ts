import type {
  ChatInputCommandInteraction} from "discord.js";
import {
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { t } from "i18next";
import { sql } from "kysely";

import db from "@/infrastructure/database/db";
import { SlashCommandHandler } from "@/interactions/handlers";
import Color from "@/utils/colors";

export default class PingCommand extends SlashCommandHandler {
  serverOnly = false;

  command = new SlashCommandBuilder()
    .setName("status")
    .setDescription("View sushii's status")
    .toJSON();

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    const discordRestStart = process.hrtime.bigint();
    await interaction.reply(
      t("ping.title", {
        ns: "commands",
      }),
    );
    const discordRestEnd = process.hrtime.bigint();

    // Just just to check latency
    const sushiiDbStart = process.hrtime.bigint();
    await sql`select 1 + 1`.execute(db);
    const sushiiDbEnd = process.hrtime.bigint();

    const currentShardId = interaction.guild?.shardId ?? 0;
    // Not just ws.ping since that's averaged of all shards
    const shardLatency =
      interaction.client.ws.shards.get(currentShardId)?.ping ?? 0;

    const content =
      `Server Shard ID: \`${currentShardId}\`` +
      `\nShard Latency: \`${shardLatency}ms\`` +
      `\nDiscord REST Latency: \`${(discordRestEnd - discordRestStart) / BigInt(1e6)}ms\`` +
      `\nDatabase Latency: \`${(sushiiDbEnd - sushiiDbStart) / BigInt(1000000)}ms\``;

    const embed = new EmbedBuilder()
      .setTitle(t("ping.title"))
      .setDescription(content)
      .setColor(Color.Success);

    await interaction.editReply({
      content: "",
      embeds: [embed],
    });
  }
}
