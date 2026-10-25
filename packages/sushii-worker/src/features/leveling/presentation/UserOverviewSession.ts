import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from "discord.js";
import type {
  ChatInputCommandInteraction,
  InteractionEditReplyOptions,
  Message,
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
  private tab: UserOverviewTab;
  private set = "all";
  private page = 0;
  private expired = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly interaction: ChatInputCommandInteraction<"cached">,
    private readonly target: User,
    private readonly deps: UserOverviewDependencies,
    initialTab: UserOverviewTab,
  ) {
    this.tab = initialTab;
  }

  private tabs() {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...(["rank", "collection"] as const).map((tab) =>
        new ButtonBuilder()
          .setCustomId(`fishycollection:${tab}`)
          .setLabel(tab === "rank" ? "Rank" : "Fishy collection")
          .setStyle(
            this.tab === tab ? ButtonStyle.Primary : ButtonStyle.Secondary,
          )
          .setDisabled(this.expired || this.tab === tab),
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
      );
      return {
        components: [...(rank.components ?? []), this.tabs()],
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
      (item) => this.set === "all" || item.set === this.set,
    );
    const pages = Math.max(1, Math.ceil(items.length / 4));
    this.page = Math.max(0, Math.min(this.page, pages - 1));
    const page = items.slice(this.page * 4, (this.page + 1) * 4);
    const discovered = items.filter((item) => counts.has(item.id)).length;
    const total = COLLECTIBLES.filter((item) => counts.has(item.id)).length;
    const image = await this.deps.artwork.grid(page, counts);
    const alt = page
      .map(
        (item) =>
          `${item.name}, ${item.rarity}, ${counts.has(item.id) ? `${counts.get(item.id)} caught` : "not discovered"}`,
      )
      .join("; ");
    const header = new TextDisplayBuilder().setContent(
      `### ${this.target.username.replace(/[\\*_~`|]/g, "")}’s Fishy collection\n` +
        `**${total}/${COLLECTIBLES.length} discovered** · ${this.set === "all" ? "All catches" : COLLECTION_SETS[this.set]}: ${discovered}/${items.length}\n` +
        (total === 0
          ? "Catch something with `/fishy` to start collecting.\n"
          : "") +
        `-# Personal collection · across all servers`,
    );
    const container = new ContainerBuilder()
      .addTextDisplayComponents(header)
      .addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder()
            .setURL("attachment://fishycollection.png")
            .setDescription(alt),
        ),
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          page
            .map(
              (item) =>
                `**${item.name}** · ${item.rarity} · ${counts.has(item.id) ? `${counts.get(item.id)} caught` : "undiscovered"}`,
            )
            .join("\n") +
            `\n-# Page ${this.page + 1}/${pages} · Silhouettes are undiscovered catches${this.expired ? " · Run /fishycollection to reopen" : ""}`,
        ),
      );
    const filter =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("fishycollection:set")
          .setPlaceholder("Choose a set")
          .setDisabled(this.expired)
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
        .setCustomId("fishycollection:previous")
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(this.expired || this.page === 0),
      new ButtonBuilder()
        .setCustomId("fishycollection:next")
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(this.expired || this.page === pages - 1),
    );
    return {
      components: [container, this.tabs(), filter, navigation],
      attachments: [],
      files: [new AttachmentBuilder(image, { name: "fishycollection.png" })],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    };
  }

  async start(): Promise<void> {
    await this.interaction.deferReply();
    const message = await this.interaction.editReply(await this.render());
    this.collect(message);
  }

  private collect(message: Message) {
    const collector = message.createMessageComponentCollector({
      idle: 5 * 60 * 1000,
      time: 14 * 60 * 1000,
    });
    collector.on("collect", async (interaction) => {
      try {
        if (interaction.user.id !== this.interaction.user.id) {
          await interaction.reply({
            content: "Run /fishycollection or /rank to open your own view.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await interaction.deferUpdate();
        // Serialize renders so rapid navigation cannot restore an older page.
        this.queue = this.queue
          .then(async () => {
            if (this.expired) return;
            if (
              interaction.isStringSelectMenu() &&
              interaction.customId === "fishycollection:set"
            ) {
              const value = interaction.values[0];
              if (value !== "all" && !Object.hasOwn(COLLECTION_SETS, value))
                return;
              this.set = value;
              this.page = 0;
            } else if (interaction.isButton()) {
              switch (interaction.customId) {
                case "fishycollection:rank":
                  this.tab = "rank";
                  break;
                case "fishycollection:collection":
                  this.tab = "collection";
                  break;
                case "fishycollection:previous":
                  this.page--;
                  break;
                case "fishycollection:next":
                  this.page++;
                  break;
                default:
                  return;
              }
            }
            await this.interaction.editReply(await this.render());
          })
          .catch(async (err) => {
            this.deps.logger.error(
              { err },
              "Fishy collection navigation failed",
            );
            try {
              await interaction.followUp({
                content: "Could not load that page. Please try again.",
                flags: MessageFlags.Ephemeral,
              });
            } catch (replyError) {
              this.deps.logger.debug(
                { err: replyError },
                "Could not send collection navigation error",
              );
            }
          });
        await this.queue;
      } catch (err) {
        this.deps.logger.error({ err }, "Fishy collection interaction failed");
      }
    });
    collector.on("end", () => {
      this.expired = true;
      this.queue = this.queue
        .then(async () => {
          await this.interaction.editReply(await this.render());
        })
        .catch((err) => {
          this.deps.logger.debug(
            { err },
            "Could not disable expired fishycollection controls",
          );
        });
    });
  }
}
