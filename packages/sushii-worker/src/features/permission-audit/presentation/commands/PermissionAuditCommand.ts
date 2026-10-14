import type { ChatInputCommandInteraction } from "discord.js";
import {
  ApplicationIntegrationType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import { getErrorMessage } from "@/interactions/responses/error";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { PermissionAuditService } from "../../application/PermissionAuditService";
import type { PermissionChangeService } from "../../application/PermissionChangeService";
import { PermissionAuditSession } from "../PermissionAuditSession";

export class PermissionAuditCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("permission-audit")
    .setDescription(
      "Find risky and unused role permissions, with suggested fixes.",
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .toJSON();

  constructor(
    private readonly auditService: PermissionAuditService,
    private readonly changeService: PermissionChangeService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild not cached");
    }

    // Servers can override command permissions in Integrations settings.
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply(
        getErrorMessage(
          "Missing permission",
          "You need Manage Server to run a permission audit.",
          true,
        ),
      );
      return;
    }

    await interaction.deferReply();
    const result = await this.auditService.generate(interaction.guild);

    this.logger.info(
      {
        guildId: interaction.guildId,
        executorId: interaction.user.id,
        findingCount: result.report.findings.length,
        backfillPending: result.context.backfillPending,
      },
      "Permission audit generated",
    );

    await new PermissionAuditSession(
      interaction,
      result,
      this.auditService,
      this.changeService,
      this.logger,
    ).start();
  }
}
