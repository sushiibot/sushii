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
    private readonly interaction:
      | ChatInputCommandInteraction<"cached">
      | ButtonInteraction<"cached">,
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
        this.tabs(),
        this.expired,
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
      (item) => this.set === "all" || item.set === this.set,
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
    const container = new ContainerBuilder()
      .addActionRowComponents(this.tabs())
      .addTextDisplayComponents(header)
      .addActionRowComponents(filter);
    const files: AttachmentBuilder[] = [];
    for (const item of page) {
      const count = counts.get(item.id) ?? 0;
      const rarity = item.rarity.charAt(0).toUpperCase() + item.rarity.slice(1);
      const text = new TextDisplayBuilder().setContent(
        `**${item.name}**\n${rarity} · ${count ? `Caught ×${count.toLocaleString()}` : "Undiscovered"}`,
      );
      const icon = await this.deps.artwork.icon(item.id, count === 0);
      if (icon) {
        const name = `${item.id}.png`;
        files.push(new AttachmentBuilder(icon, { name }));
        container.addSectionComponents(
          new SectionBuilder()
            .addTextDisplayComponents(text)
            .setThumbnailAccessory((thumbnail) =>
              thumbnail
                .setURL(`attachment://${name}`)
                .setDescription(
                  count ? item.name : `Undiscovered ${item.name}`,
                ),
            ),
        );
      } else {
        container.addTextDisplayComponents(text);
      }
    }
    const footer = [
      ...(pages > 1 ? [`Page ${this.page + 1}/${pages}`] : []),
      ...(this.expired ? ["Run /fishycollection to reopen"] : []),
    ];
    if (footer.length)
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# ${footer.join(" · ")}`),
      );
    if (pages > 1) container.addActionRowComponents(navigation);
    return {
      components: [container],
      attachments: [],
      files,
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    };
  }

  async start(ephemeral = false): Promise<void> {
    await this.interaction.deferReply(
      ephemeral ? { flags: MessageFlags.Ephemeral } : {},
    );
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
