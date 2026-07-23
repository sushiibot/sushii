import type { ChatInputCommandInteraction } from "discord.js";
import {
  InteractionContextType,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import { ComponentsV2Paginator } from "@/shared/presentation/ComponentsV2Paginator";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { LinkAccountsService } from "../../application/LinkAccountsService";
import type { ListIdentitiesService } from "../../application/ListIdentitiesService";
import type { SetNicknameService } from "../../application/SetNicknameService";
import type { UnlinkAccountService } from "../../application/UnlinkAccountService";
import type { ViewIdentityService } from "../../application/ViewIdentityService";
import {
  buildAltIdentityHistoryContainer,
  buildAltIdentityListContainer,
  buildLinkOutcomeContainer,
  buildNicknameOutcomeContainer,
  buildNoIdentityContainer,
  buildUnlinkOutcomeContainer,
} from "../views";

const LIST_PAGE_SIZE = 10;
const HISTORY_PAGE_SIZE = 10;

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
          o.setName("user_a").setDescription("First account.").setRequired(true),
        )
        .addUserOption((o) =>
          o
            .setName("user_b")
            .setDescription("Second account.")
            .setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("reason").setDescription("Optional reason.").setRequired(false),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName("unlink")
        .setDescription("Remove an account from its identity.")
        .addUserOption((o) =>
          o.setName("user").setDescription("Account to unlink.").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("reason").setDescription("Optional reason.").setRequired(false),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName("view")
        .setDescription("View an account's linked identity and merged history.")
        .addUserOption((o) =>
          o.setName("user").setDescription("Account to look up.").setRequired(true),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName("nickname")
        .setDescription("Set or clear an identity's nickname.")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("Account belonging to the identity.")
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("text")
            .setDescription("New nickname. Omit to clear.")
            .setRequired(false),
        ),
    )
    .addSubcommand((c) =>
      c.setName("list").setDescription("Browse every tracked identity in this server."),
    )
    .toJSON();

  constructor(
    private readonly linkAccountsService: LinkAccountsService,
    private readonly unlinkAccountService: UnlinkAccountService,
    private readonly viewIdentityService: ViewIdentityService,
    private readonly setNicknameService: SetNicknameService,
    private readonly listIdentitiesService: ListIdentitiesService,
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
      case "nickname":
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
    const userA = interaction.options.getUser("user_a", true);
    const userB = interaction.options.getUser("user_b", true);
    const reason = interaction.options.getString("reason");

    const log = this.logger.child({
      guildId: interaction.guildId,
      userA: userA.id,
      userB: userB.id,
      executorId: interaction.user.id,
    });

    const result = await this.linkAccountsService.link(
      interaction.guildId,
      { id: userA.id, isBot: userA.bot },
      { id: userB.id, isBot: userB.bot },
      interaction.user.id,
      reason,
    );

    if (result.err) {
      log.info({ error: result.val }, "Rejected /alts link");
      await interaction.reply({
        content: result.val,
        ephemeral: true,
      });
      return;
    }

    log.info({ outcome: result.val.kind }, "Processed /alts link");

    await interaction.reply({
      components: [
        buildLinkOutcomeContainer(result.val, userA.id, userB.id, reason),
      ],
      flags: ["IsComponentsV2"],
      allowedMentions: { parse: [] },
    });
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

    const result = await this.viewIdentityService.view(
      interaction.guildId,
      user.id,
    );

    if (result.err) {
      await interaction.reply({
        content: `Failed to view identity: ${result.val}`,
        ephemeral: true,
      });
      return;
    }

    if (!result.val) {
      await interaction.reply({
        components: [buildNoIdentityContainer(user.id)],
        flags: ["IsComponentsV2"],
        allowedMentions: { parse: [] },
      });
      return;
    }

    const { identity, history } = result.val;

    const paginator = new ComponentsV2Paginator({
      interaction,
      pageSize: HISTORY_PAGE_SIZE,
      callbacks: {
        fetchPage: async (pageIndex, pageSize) =>
          history.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize),
        getTotalCount: async () => history.length,
        renderContainer: (cases, state, navButtons) =>
          buildAltIdentityHistoryContainer(
            identity,
            cases,
            history.length,
            navButtons,
            state.isDisabled,
          ),
      },
    });

    await paginator.start(false);
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
