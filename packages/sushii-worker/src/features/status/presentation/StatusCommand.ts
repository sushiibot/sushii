import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { SlashCommandHandler } from "@/interactions/handlers";
import Color from "@/utils/colors";

import type { DrizzleStatusRepository } from "../infrastructure/DrizzleStatusRepository";

export default class StatusCommand extends SlashCommandHandler {
  serverOnly = false;

  command = new SlashCommandBuilder()
    .setName("status")
    .setDescription("View sushii's status")
    .toJSON();

  constructor(private readonly statusRepository: DrizzleStatusRepository) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    const discordRestStart = process.hrtime.bigint();
    await interaction.reply("Checking message ping...");
    const discordRestEnd = process.hrtime.bigint();

    const currentClusterId = interaction.client.cluster.id;

    const currentShardId = interaction.guild?.shardId ?? 0;
    const shardLatency =
      interaction.client.ws.shards.get(currentShardId)?.ping ?? 0;

    const databaseLatency = await this.statusRepository.checkDatabaseLatency();

    const discordRestMs = Number(
      (discordRestEnd - discordRestStart) / BigInt(1_000_000),
    );
    const databaseMs = Number(databaseLatency / BigInt(1_000_000));

    const content =
      `Server Shard ID: \`${currentShardId}\` (cluster \`${currentClusterId}\`)` +
      `\nShard Latency: \`${shardLatency}ms\`` +
      `\nDiscord REST Latency: \`${discordRestMs}ms\`` +
      `\nDatabase Latency: \`${databaseMs}ms\``;

    const embed = new EmbedBuilder()
      .setTitle("Status")
      .setDescription(content)
      .setColor(Color.Success);

    await interaction.editReply({
      content: "",
      embeds: [embed],
    });
  }
}
