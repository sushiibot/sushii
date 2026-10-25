import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from "discord.js";
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  InteractionEditReplyOptions,
  StringSelectMenuInteraction,
  User,
} from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";
import {
  COLLECTIBLES,
  COLLECTION_SETS,
} from "@/features/social/domain/collection/Catalog";
import type { FishyCollectionRepository } from "@/features/social/domain/repositories/FishyCollectionRepository";
import type { CollectionArtwork } from "@/features/social/infrastructure/CollectionArtwork";

import type { GetUserRankService } from "../application/GetUserRankService";
import { RANK_CARD_EMOJIS, formatRankCard } from "./views/RankDisplayView";

export type UserOverviewTab = "rank" | "collection";
export interface UserOverviewDependencies {
  rankService: GetUserRankService;
  emojiRepository: BotEmojiRepository;
  collectionRepository: FishyCollectionRepository;
  artwork: CollectionArtwork;
  logger: Logger;
}

export class UserOverviewSession {
  // Only in-flight edits are retained; navigation needs no stored session.
  private static readonly updates = new Map<string, Promise<void>>();
  private tab: UserOverviewTab;
  private set = "all";
  private page = 0;
  private collectedOnly = false;

  constructor(
    private readonly interaction:
      | ChatInputCommandInteraction<"cached">
      | ButtonInteraction<"cached">
      | StringSelectMenuInteraction<"cached">,
    private readonly target: User,
    private readonly deps: UserOverviewDependencies,
    initialTab: UserOverviewTab,
  ) {
    this.tab = initialTab;
  }

  private customId(action: string): string {
    return `fishyview/${this.target.id}/${this.interaction.user.id}/${this.tab}/${this.set}/${this.page}/${this.collectedOnly ? 1 : 0}/${action}`;
  }

  private tabs() {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...(["rank", "collection"] as const).map((tab) =>
        new ButtonBuilder()
          .setCustomId(this.customId(tab))
          .setLabel(tab === "rank" ? "Rank" : "Fishy collection")
          .setStyle(
            this.tab === tab ? ButtonStyle.Primary : ButtonStyle.Secondary,
          )
          .setDisabled(this.tab === tab),
      ),
    );
  }

  private async render(): Promise<InteractionEditReplyOptions> {
    if (this.tab === "rank") {
      const result = await this.deps.rankService.execute(
        this.target,
        this.interaction.guildId,
      );
      if (result.err) throw new Error("Could not load rank data");
      const emojis =
        await this.deps.emojiRepository.getEmojis(RANK_CARD_EMOJIS);
      const rank = formatRankCard(
        result.val,
        this.target.displayAvatarURL({ size: 512 }),
        emojis,
        this.tabs(),
      );
      return {
        components: rank.components,
        attachments: [],
        files: [],
        allowedMentions: { parse: [] },
        flags: MessageFlags.IsComponentsV2,
      };
    }
    const entries = await this.deps.collectionRepository.getCollection(
      this.target.id,
    );
    const counts = new Map(
      entries.map((entry) => [entry.collectibleId, entry.catchCount]),
    );
    const items = COLLECTIBLES.filter(
      (item) =>
        (this.set === "all" || item.set === this.set) &&
        (!this.collectedOnly || (counts.get(item.id) ?? 0) > 0),
    );
    const pages = Math.max(1, Math.ceil(items.length / 4));
    this.page = Math.max(0, Math.min(this.page, pages - 1));
    const page = items.slice(this.page * 4, (this.page + 1) * 4);
    const total = COLLECTIBLES.filter((item) => counts.has(item.id)).length;
    const header = new TextDisplayBuilder().setContent(
      `### ${this.target.username.replace(/[\\*_~`|]/g, "")}’s Fishy collection\n` +
        `**${total}/${COLLECTIBLES.length} discovered**` +
        (total === 0 ? "\nUse `/fishy` to make your first discovery." : ""),
    );
    const filter =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(this.customId("set"))
          .setPlaceholder("Choose a set")
          .addOptions([
            { label: "All catches", value: "all", default: this.set === "all" },
            ...Object.entries(COLLECTION_SETS).map(([value, label]) => ({
              value,
              label: `${label} · ${COLLECTIBLES.filter((i) => i.set === value && counts.has(i.id)).length}/${COLLECTIBLES.filter((i) => i.set === value).length}`,
              default: this.set === value,
            })),
          ]),
      );
    const navigation = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(this.customId("previous"))
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(this.page === 0),
      new ButtonBuilder()
        .setCustomId(this.customId("next"))
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(this.page === pages - 1),
    );
    const container = new ContainerBuilder()
      .addActionRowComponents(this.tabs())
      .addTextDisplayComponents(header)
      .addActionRowComponents(filter)
      .addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(this.customId("collected"))
            .setLabel("Collected only")
            .setStyle(
              this.collectedOnly ? ButtonStyle.Primary : ButtonStyle.Secondary,
            ),
        ),
      );
    if (page.length === 0) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          this.set === "all"
            ? "No fishies collected yet."
            : "No collected fishies in this set yet.",
        ),
      );
    }
    const files: AttachmentBuilder[] = [];
    for (const item of page) {
      const count = counts.get(item.id) ?? 0;
      const rarity = item.rarity.charAt(0).toUpperCase() + item.rarity.slice(1);
      const text = new TextDisplayBuilder().setContent(
        `**${item.name}**\n${rarity} · ${count ? `Caught ×${count.toLocaleString()}` : "Undiscovered"}`,
      );
      const url = await this.deps.artwork.url(item.id, count === 0);
      const icon = url
        ? undefined
        : await this.deps.artwork.icon(item.id, count === 0);
      if (url || icon) {
        const name = `${item.id}.png`;
        if (icon) files.push(new AttachmentBuilder(icon, { name }));
        container.addSectionComponents(
          new SectionBuilder()
            .addTextDisplayComponents(text)
            .setThumbnailAccessory((thumbnail) =>
              thumbnail
                .setURL(url ?? `attachment://${name}`)
                .setDescription(
                  count ? item.name : `Undiscovered ${item.name}`,
                ),
            ),
        );
      } else {
        container.addTextDisplayComponents(text);
      }
    }
    if (pages > 1) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `-# Page ${this.page + 1}/${pages}`,
        ),
      );
      container.addActionRowComponents(navigation);
    }
    return {
      components: [container],
      attachments: [],
      files,
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    };
  }

  async start(): Promise<void> {
    await this.interaction.deferReply();
    await this.interaction.editReply(await this.render());
  }

  // Every control carries its view state so it works after a restart without
  // a collector or the original interaction's 15-minute webhook token.
  static async navigate(
    interaction:
      | ButtonInteraction<"cached">
      | StringSelectMenuInteraction<"cached">,
    deps: UserOverviewDependencies,
  ): Promise<void> {
    const [, targetId, ownerId, tab, set, page, collected, action] =
      interaction.customId.split("/");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "Run /fishycollection or /rank to open your own view.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (
      !/^\d{17,20}$/.test(targetId ?? "") ||
      (tab !== "rank" && tab !== "collection") ||
      (set !== "all" && !Object.hasOwn(COLLECTION_SETS, set ?? "")) ||
      !/^\d{1,3}$/.test(page ?? "") ||
      (collected !== "0" && collected !== "1") ||
      !["rank", "collection", "previous", "next", "set", "collected"].includes(
        action ?? "",
      )
    ) {
      await interaction.reply({
        content: "Run /fishycollection to open a new view.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferUpdate();
    const messageId = interaction.message.id;
    const previous = this.updates.get(messageId) ?? Promise.resolve();
    const update = previous
      .catch(() => {
        // The previous interaction's router reports its failure independently.
      })
      .then(async () => {
        const target = await interaction.client.users.fetch(targetId);
        const session = new UserOverviewSession(interaction, target, deps, tab);
        session.set = set;
        session.page = Number(page);
        session.collectedOnly = collected === "1";
        if (interaction.isStringSelectMenu() && action === "set") {
          const value = interaction.values[0];
          if (value !== "all" && !Object.hasOwn(COLLECTION_SETS, value ?? ""))
            return;
          session.set = value;
          session.page = 0;
        } else if (interaction.isButton()) {
          switch (action) {
            case "rank":
              session.tab = "rank";
              break;
            case "collection":
              session.tab = "collection";
              break;
            case "previous":
              session.page--;
              break;
            case "next":
              session.page++;
              break;
            case "collected":
              session.collectedOnly = !session.collectedOnly;
              session.page = 0;
              break;
          }
        }
        await interaction.editReply(await session.render());
      });
    this.updates.set(messageId, update);
    try {
      await update;
    } finally {
      if (this.updates.get(messageId) === update)
        this.updates.delete(messageId);
    }
  }
}
