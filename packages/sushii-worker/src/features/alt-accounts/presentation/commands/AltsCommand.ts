import type { ChatInputCommandInteraction } from "discord.js";
import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import type { ModViewDependencies } from "@/features/moderation/mod-view/presentation/ModViewEntry";
import { openModViewOrReportError } from "@/features/moderation/mod-view/presentation/ModViewEntry";
import { ComponentsV2Paginator } from "@/shared/presentation/ComponentsV2Paginator";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type {
  LinkAccountsService,
  LinkTarget,
} from "../../application/LinkAccountsService";
import type { ListIdentitiesService } from "../../application/ListIdentitiesService";
import type { SetNicknameService } from "../../application/SetNicknameService";
import type { UnlinkAccountService } from "../../application/UnlinkAccountService";
import {
  parseAccountTokens,
  resolveAdditionalAccounts,
  validateAccountTokens,
} from "../AdditionalAccountsResolver";
import {
  buildAltIdentityListContainer,
  buildLinkOutcomeContainer,
  buildNicknameOutcomeContainer,
  buildUnlinkOutcomeContainer,
} from "../views";

const LIST_PAGE_SIZE = 10;
/** Stored per member row and re-rendered on every future view of the identity. */
const REASON_MAX_LENGTH = 400;

export class AltsCommand extends SlashCommandHandler {
  requiredBotPermissions = new PermissionsBitField();

  command = new SlashCommandBuilder()
    .setName("alts")
    .setDescription("Track and look up alt-account relationships.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((c) =>
      c
        .setName("link")
        .setDescription("Link two accounts as belonging to the same person.")
        .addUserOption((o) =>
          o
            .setName("account_1")
            .setDescription("First account.")
            .setRequired(true),
        )
        .addUserOption((o) =>
          o
            .setName("account_2")
            .setDescription("Second account.")
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("additional_accounts")
            .setDescription(
              "More accounts: space or comma separated user IDs or mentions (25 total max).",
            )
            .setRequired(false),
        )
        .addStringOption((o) =>
          o
            .setName("reason")
            .setDescription("Optional reason.")
            .setRequired(false)
            .setMaxLength(REASON_MAX_LENGTH),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName("unlink")
        .setDescription("Remove an account from its identity.")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("Account to unlink.")
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("reason")
            .setDescription("Optional reason.")
            .setRequired(false),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName("view")
        .setDescription("View an account's linked identity.")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("Account to look up.")
            .setRequired(true),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName("rename")
        .setDescription("Set or clear an identity's name.")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("Account belonging to the identity.")
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("text")
            .setDescription("New identity name. Omit to clear.")
            .setRequired(false),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName("list")
        .setDescription("Browse every tracked identity in this server."),
    )
    .toJSON();

  constructor(
    private readonly linkAccountsService: LinkAccountsService,
    private readonly unlinkAccountService: UnlinkAccountService,
    private readonly setNicknameService: SetNicknameService,
    private readonly listIdentitiesService: ListIdentitiesService,
    private readonly modViewDependencies: ModViewDependencies,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild not cached");
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case "link":
        return this.handleLink(interaction);
      case "unlink":
        return this.handleUnlink(interaction);
      case "view":
        return this.handleView(interaction);
      case "rename":
        return this.handleNickname(interaction);
      case "list":
        return this.handleList(interaction);
      default:
        throw new Error("Invalid subcommand.");
    }
  }

  private async handleLink(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const userA = interaction.options.getUser("account_1", true);
    const userB = interaction.options.getUser("account_2", true);
    const additionalRaw = interaction.options.getString("additional_accounts");
    const reason = interaction.options.getString("reason");

    const log = this.logger.child({
      guildId: interaction.guildId,
      userA: userA.id,
      userB: userB.id,
      executorId: interaction.user.id,
    });

    let additional: LinkTarget[] = [];
    let invalidTokens: string[] = [];
    let unresolvedIds: string[] = [];
    let parsedUserIds: string[] = [];

    // Parsing and validation happen before deferring so a bad list still gets
    // an ephemeral error rather than a public one.
    if (additionalRaw !== null) {
      const parsed = parseAccountTokens(additionalRaw);
      const valid = validateAccountTokens(parsed);

      if (valid.err) {
        log.info({ error: valid.val }, "Rejected /alts link");
        await interaction.reply({
          content: valid.val,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      invalidTokens = parsed.invalidTokens;
      parsedUserIds = parsed.userIds;
    }

    // Only the extra-accounts path needs Discord fetches, so the two-account
    // path keeps its immediate reply.
    const deferred = parsedUserIds.length > 0;
    if (deferred) {
      await interaction.deferReply();

      ({ targets: additional, unresolvedIds } = await resolveAdditionalAccounts(
        interaction,
        parsedUserIds,
      ));
    }

    const result = await this.linkAccountsService.link({
      guildId: interaction.guildId,
      primary: [
        { id: userA.id, isBot: userA.bot },
        { id: userB.id, isBot: userB.bot },
      ],
      additional,
      linkedBy: interaction.user.id,
      reason,
    });

    if (result.err) {
      log.info({ error: result.val }, "Rejected /alts link");
      await this.respondError(interaction, deferred, result.val);
      return;
    }

    log.info(
      {
        identityCreated: result.val.identityCreated,
        added: result.val.addedUserIds.length,
        merged: result.val.mergedIdentityIds.length,
      },
      "Processed /alts link",
    );

    const container = buildLinkOutcomeContainer(result.val, {
      primaryUserIds: [userA.id, userB.id],
      reason,
      invalidTokens,
      unresolvedIds,
    });

    if (deferred) {
      await interaction.editReply({
        components: [container],
        flags: ["IsComponentsV2"],
        allowedMentions: { parse: [] },
      });
    } else {
      await interaction.reply({
        components: [container],
        flags: ["IsComponentsV2"],
        allowedMentions: { parse: [] },
      });
    }
  }

  private async respondError(
    interaction: ChatInputCommandInteraction<"cached">,
    deferred: boolean,
    content: string,
  ): Promise<void> {
    if (deferred) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  }

  private async handleUnlink(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason");

    const result = await this.unlinkAccountService.unlink(
      interaction.guildId,
      user.id,
    );

    if (result.err) {
      await interaction.reply({
        content: `Failed to unlink account: ${result.val}`,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      components: [buildUnlinkOutcomeContainer(result.val, user.id, reason)],
      flags: ["IsComponentsV2"],
      allowedMentions: { parse: [] },
    });
  }

  private async handleView(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const user = interaction.options.getUser("user", true);

    await openModViewOrReportError(
      interaction,
      user,
      this.modViewDependencies,
      "alts",
    );
  }

  private async handleNickname(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const user = interaction.options.getUser("user", true);
    const nickname = interaction.options.getString("text");

    const result = await this.setNicknameService.setNickname(
      interaction.guildId,
      user.id,
      nickname,
    );

    if (result.err) {
      await interaction.reply({
        content: result.val,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      components: [
        buildNicknameOutcomeContainer(result.val, user.id, nickname),
      ],
      flags: ["IsComponentsV2"],
      allowedMentions: { parse: [] },
    });
  }

  private async handleList(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const paginator = new ComponentsV2Paginator({
      interaction,
      pageSize: LIST_PAGE_SIZE,
      callbacks: {
        fetchPage: async (pageIndex, pageSize) =>
          this.listIdentitiesService.listPage(
            interaction.guildId,
            pageIndex,
            pageSize,
          ),
        getTotalCount: async () =>
          this.listIdentitiesService.count(interaction.guildId),
        renderContainer: (identities, state, navButtons) =>
          buildAltIdentityListContainer(
            identities,
            navButtons,
            state.isDisabled,
          ),
      },
    });

    await paginator.start(false);
  }
}
