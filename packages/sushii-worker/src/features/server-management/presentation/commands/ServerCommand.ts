import type { ChatInputCommandInteraction } from "discord.js";
import {
  ApplicationIntegrationType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import type { PermissionUsageRecorder } from "@/features/permission-audit";
import type { CommandMentions } from "@/shared/presentation/commandMentions";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type {
  Executor,
  ServerAppearanceService,
} from "../../application/ServerAppearanceService";
import type { ServerImageKind } from "../../domain/serverImage";
import { checkServerImage } from "../../domain/serverImage";
import type { ServerAppearanceError } from "../views/ServerAppearanceView";
import {
  buildServerAppearanceErrorReply,
  buildServerImageChangedMessage,
  buildServerNameRestoredMessage,
  buildServerRenamedMessage,
  describeServerAppearanceError,
} from "../views/ServerAppearanceView";

enum ServerSubcommand {
  Icon = "icon",
  Banner = "banner",
  Name = "name",
  RestoreName = "restore-name",
}

enum ServerOption {
  Image = "image",
  Name = "name",
}

type GuildInteraction = ChatInputCommandInteraction<"cached">;

export class ServerCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("server")
    .setDescription("Change the server icon, banner or name.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((c) =>
      c
        .setName(ServerSubcommand.Icon)
        .setDescription("Change the server icon.")
        .addAttachmentOption((o) =>
          o
            .setName(ServerOption.Image)
            .setDescription("New icon (PNG, JPG, GIF or WebP).")
            .setRequired(true),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName(ServerSubcommand.Banner)
        .setDescription("Change the server banner.")
        .addAttachmentOption((o) =>
          o
            .setName(ServerOption.Image)
            .setDescription("New banner (PNG, JPG, GIF or WebP).")
            .setRequired(true),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName(ServerSubcommand.Name)
        .setDescription("Rename the server.")
        .addStringOption((o) =>
          o
            .setName(ServerOption.Name)
            .setDescription("New server name.")
            .setMinLength(2)
            .setMaxLength(100)
            .setRequired(true),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName(ServerSubcommand.RestoreName)
        .setDescription(
          "Change the server name back to what it was before /server name.",
        ),
    )
    .toJSON();

  constructor(
    private readonly appearanceService: ServerAppearanceService,
    private readonly permissionUsageRecorder: PermissionUsageRecorder,
    private readonly commandMentions: CommandMentions,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild not cached");
    }

    const subcommand = interaction.options.getSubcommand() as ServerSubcommand;
    const target =
      subcommand === ServerSubcommand.Icon ||
      subcommand === ServerSubcommand.Banner
        ? subcommand
        : "name";

    const botCanManage = interaction.guild.members.me?.permissions.has(
      PermissionFlagsBits.ManageGuild,
    );
    if (!botCanManage) {
      await this.replyError(interaction, "bot_missing_permission", target);
      return;
    }

    switch (subcommand) {
      case ServerSubcommand.Icon:
      case ServerSubcommand.Banner:
        await this.handleImage(interaction, subcommand);
        return;
      case ServerSubcommand.Name:
        await this.handleName(interaction);
        return;
      case ServerSubcommand.RestoreName:
        await this.handleRestoreName(interaction);
        return;
      default:
        throw new Error(`Unknown subcommand: ${subcommand}`);
    }
  }

  private async handleImage(
    interaction: GuildInteraction,
    kind: ServerImageKind,
  ): Promise<void> {
    const attachment = interaction.options.getAttachment(
      ServerOption.Image,
      true,
    );

    const imageError = checkServerImage(
      kind,
      { contentType: attachment.contentType, size: attachment.size },
      interaction.guild.features,
    );
    if (imageError) {
      await this.replyError(interaction, imageError, kind);
      return;
    }

    // defer: downloads the current image and uploads the new one to Discord
    await interaction.deferReply();

    const result = await this.appearanceService.setImage(
      interaction.guild,
      kind,
      attachment.url,
      this.executor(interaction, kind),
    );

    if (result.err) {
      // Swap the public placeholder for a private error so a failed upload isn't announced.
      await interaction.deleteReply();
      await interaction.followUp(
        buildServerAppearanceErrorReply(
          describeServerAppearanceError(
            result.val,
            kind,
            this.mention(interaction),
          ),
        ),
      );
      return;
    }

    await this.recordUsage(interaction);
    await interaction.editReply(
      buildServerImageChangedMessage(
        kind,
        result.val,
        interaction.user.id,
        this.mention(interaction),
      ),
    );
  }

  private async handleName(interaction: GuildInteraction): Promise<void> {
    const name = interaction.options.getString(ServerOption.Name, true);

    const rename = await this.appearanceService.rename(
      interaction.guild,
      name,
      this.executor(interaction, ServerSubcommand.Name),
    );

    await this.recordUsage(interaction);
    await interaction.reply(
      buildServerRenamedMessage(
        rename,
        name,
        interaction.user.id,
        this.mention(interaction),
      ),
    );
  }

  private async handleRestoreName(
    interaction: GuildInteraction,
  ): Promise<void> {
    const result = await this.appearanceService.restoreName(
      interaction.guild,
      this.executor(interaction, ServerSubcommand.RestoreName),
    );

    if (result.err) {
      await this.replyError(interaction, result.val, "name");
      return;
    }

    await this.recordUsage(interaction);
    await interaction.reply(
      buildServerNameRestoredMessage(result.val, interaction.user.id),
    );
  }

  private async replyError(
    interaction: GuildInteraction,
    error: ServerAppearanceError,
    target: ServerImageKind | "name",
  ): Promise<void> {
    this.logger.debug(
      { guildId: interaction.guildId, error, target },
      "Server appearance change rejected",
    );

    await interaction.reply(
      buildServerAppearanceErrorReply(
        describeServerAppearanceError(error, target, this.mention(interaction)),
      ),
    );
  }

  private executor(
    interaction: GuildInteraction,
    subcommand: `${ServerSubcommand}`,
  ): Executor {
    return {
      id: interaction.user.id,
      auditReason: `${interaction.user.username} via /server ${subcommand}`,
    };
  }

  private mention(interaction: GuildInteraction): (path: string) => string {
    return (path) => this.commandMentions.mention(path, interaction.guildId);
  }

  private async recordUsage(interaction: GuildInteraction): Promise<void> {
    await this.permissionUsageRecorder.recordSushiiAction({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      permission: "ManageGuild",
      channelId: null,
    });
  }
}
