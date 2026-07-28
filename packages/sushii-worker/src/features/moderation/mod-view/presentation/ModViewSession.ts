import { sleep } from "bun";
import type {
  ButtonBuilder,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ContainerBuilder,
  Guild,
  GuildMember,
  ModalSubmitInteraction,
  User,
  UserContextMenuCommandInteraction,
} from "discord.js";
import {
  ActionRowBuilder,
  ComponentType,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { Logger } from "pino";

import { NICKNAME_MAX_LENGTH } from "@/features/alt-accounts/application/SetNicknameService";
import type { SetNicknameService } from "@/features/alt-accounts/application/SetNicknameService";
import type { BotEmojiRepository, EmojiMap } from "@/features/bot-emojis";
import type { UserLookupBan } from "@/features/moderation/cases/domain/entities/UserLookupBan";
import { HISTORY_ACTION_EMOJIS } from "@/features/moderation/cases/presentation/views/HistoryView";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { getErrorMessage } from "@/interactions/responses/error";
import { ComponentsV2Paginator } from "@/shared/presentation/ComponentsV2Paginator";

import type {
  ModViewResult,
  ModViewService,
} from "../application/ModViewService";
import { MODVIEW_CUSTOM_IDS } from "./customIds";
import {
  MODVIEW_IDLE_TIMEOUT_MS,
  createModViewMessage,
} from "./views/ModViewMessageBuilder";
import type { ModViewTab } from "./views/components/ModViewChrome";
import { deriveHistoryTabView } from "./views/tabs/HistoryTabBuilder";
import { chunkLookupBans } from "./views/tabs/LookupTabBuilder";

/** Both entry points reply with a fresh, un-deferred, guild-cached interaction. */
export type ModViewEntryInteraction =
  | ChatInputCommandInteraction<"cached">
  | UserContextMenuCommandInteraction<"cached">;

export interface ModViewDependencies {
  modViewService: ModViewService;
  emojiRepository: BotEmojiRepository;
  setNicknameService: SetNicknameService;
  logger: Logger;
}

/**
 * Kept under the collector's idle window so a modal left open can never
 * outlive the session it re-renders — and the render after submit re-checks
 * `collector.ended` anyway.
 */
const MODAL_TIMEOUT_MS = MODVIEW_IDLE_TIMEOUT_MS - 30_000;

const REJECTION_MESSAGE =
  "These controls belong to whoever opened this view — run your own `/modview`.";

type ModViewPaginator =
  | ComponentsV2Paginator<ModerationCase[]>
  | ComponentsV2Paginator<UserLookupBan[]>;

/**
 * A paginator can be built from the entry interaction (a deep-link opening
 * straight onto a paginated tab) or from a later tab-switch click —
 * `ComponentsV2Paginator` already accepts both.
 */
type ModViewPaginatorSource =
  | ButtonInteraction<"cached">
  | ChatInputCommandInteraction<"cached">;

type ModViewMessage = ReturnType<typeof createModViewMessage>;

/**
 * Both the tab row and Overview's `View ›` accessories open screens, and they
 * coexist on the Overview render — so they carry distinct IDs (Discord
 * rejects a message with duplicate `custom_id`s) that map to the same tabs.
 */
const TAB_BY_CUSTOM_ID: ReadonlyMap<string, ModViewTab> = new Map([
  [MODVIEW_CUSTOM_IDS.tabOverview, "overview"],
  [MODVIEW_CUSTOM_IDS.tabHistory, "history"],
  [MODVIEW_CUSTOM_IDS.tabAlts, "alts"],
  [MODVIEW_CUSTOM_IDS.tabNames, "names"],
  [MODVIEW_CUSTOM_IDS.tabLookup, "lookup"],
  [MODVIEW_CUSTOM_IDS.openHistory, "history"],
  [MODVIEW_CUSTOM_IDS.openAlts, "alts"],
  [MODVIEW_CUSTOM_IDS.openNames, "names"],
  [MODVIEW_CUSTOM_IDS.openLookup, "lookup"],
]);

/**
 * One Mod View session: the message, its single collector, and the in-memory
 * state (`{ targetUser, targetMember, activeTab, includeAlts, paginator }`)
 * that lives for as long as the collector does.
 *
 * The session never calls `ComponentsV2Paginator.start()` — see
 * `openPaginatedTab`.
 */
export class ModViewSession {
  private activeTab: ModViewTab = "overview";
  private includeAlts = true;
  private paginator: ModViewPaginator | null = null;
  private expired = false;

  constructor(
    private readonly interaction: ModViewEntryInteraction,
    private readonly data: ModViewResult,
    private readonly targetUser: User,
    private readonly targetMember: GuildMember | null,
    private readonly emojis: EmojiMap<typeof HISTORY_ACTION_EMOJIS>,
    private readonly setNicknameService: SetNicknameService,
    private readonly logger: Logger,
    initialTab: ModViewTab = "overview",
  ) {
    this.activeTab = initialTab;
  }

  /**
   * A deep-linked command (e.g. `/history`) opens straight onto a tab that
   * may be paginated. `createPaginator` already returns `null` for the
   * unpaginated tabs and for Lookup when `data.lookup` is null, so its
   * "is this tab paginated" logic is reused rather than re-derived here.
   * Only a `ChatInputCommandInteraction` reaches this: the context menu entry
   * point always starts on Overview, which is never paginated.
   */
  async start(): Promise<void> {
    this.paginator = this.interaction.isChatInputCommand()
      ? this.createPaginator(this.interaction)
      : null;

    const initialReply = this.paginator
      ? await this.paginator.renderCurrentPage()
      : this.renderScreen({ disabled: false });

    const msg = await this.interaction.reply(initialReply);

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      idle: MODVIEW_IDLE_TIMEOUT_MS,
    });

    collector.on("collect", async (i) => {
      try {
        // The paginator's own author check compares the clicker against the
        // interaction it was built from — which is the clicker. It can never
        // reject, so ownership is enforced here, against the invoker.
        if (i.user.id !== this.interaction.user.id) {
          const rejection = await i.reply({
            content: REJECTION_MESSAGE,
            flags: MessageFlags.Ephemeral,
          });
          await sleep(2500);
          await rejection.delete();
          return;
        }

        await this.handleButton(i);
      } catch (err) {
        this.logger.error(
          { err, customId: i.customId, targetId: this.targetUser.id },
          "Failed to handle mod view interaction",
        );
      }
    });

    collector.on("end", async () => {
      this.expired = true;

      try {
        await msg.edit(await this.renderExpired());
      } catch (err) {
        this.logger.error(
          { err, targetId: this.targetUser.id },
          "Failed to disable mod view components",
        );
      }
    });
  }

  private async handleButton(i: ButtonInteraction<"cached">): Promise<void> {
    // Returns false for anything that isn't one of its own five buttons, so
    // tab/filter/rename clicks fall through — the documented shared-collector
    // path.
    if (this.paginator && (await this.paginator.handleButtonInteraction(i))) {
      return;
    }

    const tab = TAB_BY_CUSTOM_ID.get(i.customId);
    if (tab) {
      await this.openTab(i, tab);
      return;
    }

    if (i.customId === MODVIEW_CUSTOM_IDS.historyAlts) {
      await this.toggleAltFilter(i);
      return;
    }

    if (i.customId === MODVIEW_CUSTOM_IDS.altsNickname) {
      await this.renameIdentity(i);
      return;
    }

    this.logger.warn(
      { customId: i.customId, targetId: this.targetUser.id },
      "Unknown mod view button",
    );
  }

  private async openTab(
    i: ButtonInteraction<"cached">,
    tab: ModViewTab,
  ): Promise<void> {
    this.activeTab = tab;
    this.paginator = this.createPaginator(i);

    if (this.paginator) {
      await this.openPaginatedTab(i, this.paginator);
      return;
    }

    await i.update(this.renderScreen({ disabled: false }));
  }

  /**
   * The only place a paginator reaches the message. `start()` is never called:
   * it replies rather than updates, which on a `ButtonInteraction` posts a
   * second message and binds a collector to it. Render, then update in place.
   */
  private async openPaginatedTab(
    i: ButtonInteraction<"cached">,
    paginator: ModViewPaginator,
  ): Promise<void> {
    await i.update(await paginator.renderCurrentPage());
  }

  private async toggleAltFilter(i: ButtonInteraction<"cached">): Promise<void> {
    this.includeAlts = !this.includeAlts;
    this.activeTab = "history";

    // Rebuilding the paginator re-chunks against the new filter and resets to
    // page 1 in one step — the pages a paginator serves are fixed at
    // construction.
    const paginator = this.createHistoryPaginator(i);
    this.paginator = paginator;

    await this.openPaginatedTab(i, paginator);
  }

  /**
   * Deliberately separate from the globally-routed `alts:nickname:` handler:
   * routing this click globally would replace the whole message with a bare
   * alt panel and destroy the view's chrome. Both paths call
   * `setNicknameByIdentityId`, so the write behavior cannot diverge — merging
   * them would reintroduce the routing failure.
   */
  private async renameIdentity(i: ButtonInteraction<"cached">): Promise<void> {
    const identity = this.data.identity;
    if (!identity) {
      return;
    }

    const modalCustomId = `${MODVIEW_CUSTOM_IDS.altsNicknameModal}:${i.id}`;
    const input = new TextInputBuilder()
      .setCustomId("identity_name")
      .setLabel("Identity name")
      .setRequired(false)
      .setMaxLength(NICKNAME_MAX_LENGTH)
      .setPlaceholder("Leave empty to clear the name")
      .setStyle(TextInputStyle.Short);

    await i.showModal(
      new ModalBuilder()
        .setCustomId(modalCustomId)
        .setTitle("Set Identity Name")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(input),
        ),
    );

    let submission: ModalSubmitInteraction<"cached">;
    try {
      submission = await i.awaitModalSubmit({
        time: MODAL_TIMEOUT_MS,
        filter: (m) => m.user.id === i.user.id && m.customId === modalCustomId,
      });
    } catch {
      this.logger.debug(
        { identityId: identity.identity.id, targetId: this.targetUser.id },
        "Mod view identity rename modal timed out",
      );
      return;
    }

    const value = submission.fields.getTextInputValue("identity_name");
    const result = await this.setNicknameService.setNicknameByIdentityId(
      this.interaction.guildId,
      identity.identity.id,
      value.length > 0 ? value : null,
    );

    if (!result.ok) {
      await submission.reply(
        getErrorMessage("Failed to set identity name", result.val),
      );
      return;
    }

    this.data.identity = result.val;
    this.activeTab = "alts";
    this.paginator = null;

    if (!submission.isFromMessage()) {
      throw new Error("Mod view identity modal was not opened from a message");
    }

    // The modal can outlive the collector's idle window; re-rendering enabled
    // after expiry would restore live-looking buttons that nothing collects.
    // Read after the await, never before it.
    await submission.update(this.renderScreen({ disabled: this.expired }));
  }

  private createPaginator(i: ModViewPaginatorSource): ModViewPaginator | null {
    if (this.activeTab === "history") {
      return this.createHistoryPaginator(i);
    }

    if (this.activeTab === "lookup" && this.data.lookup) {
      return this.createLookupPaginator(i);
    }

    return null;
  }

  private createHistoryPaginator(
    i: ModViewPaginatorSource,
  ): ComponentsV2Paginator<ModerationCase[]> {
    // Same derivation the tab's content builder runs, so page boundaries and
    // rendered rows cannot disagree.
    const { pages } = deriveHistoryTabView(
      this.data.history,
      this.data.userInfo.id,
      this.emojis,
      this.includeAlts,
    );

    return new ComponentsV2Paginator<ModerationCase[]>({
      interaction: i,
      // Each page is one pre-packed bin, already oldest-at-top within itself.
      pageSize: 1,
      logger: this.logger,
      callbacks: {
        fetchPage: async (pageIndex) =>
          pages[pageIndex] ? [pages[pageIndex]] : [],
        getTotalCount: async () => pages.length,
        renderContainer: ([pageCases], state, navButtons) =>
          this.renderContainer({
            disabled: state.isDisabled,
            navButtons,
            historyPageCases: pageCases ?? [],
          }),
      },
    });
  }

  private createLookupPaginator(
    i: ModViewPaginatorSource,
  ): ComponentsV2Paginator<UserLookupBan[]> {
    const lookup = this.data.lookup;
    if (!lookup) {
      throw new Error("Lookup paginator built without lookup data");
    }

    const pages = chunkLookupBans(
      lookup.crossServerBans,
      lookup.currentGuildLookupOptIn,
    );

    return new ComponentsV2Paginator<UserLookupBan[]>({
      interaction: i,
      pageSize: 1,
      logger: this.logger,
      callbacks: {
        fetchPage: async (pageIndex) =>
          pages[pageIndex] ? [pages[pageIndex]] : [],
        getTotalCount: async () => pages.length,
        renderContainer: ([pageBans], state, navButtons) =>
          this.renderContainer({
            disabled: state.isDisabled,
            navButtons,
            lookupPageBans: pageBans ?? [],
          }),
      },
    });
  }

  private async renderExpired(): Promise<ModViewMessage> {
    // Skipping `start()` also skips the paginator's own end handler, so
    // disabling the view on expiry is this session's job on every tab —
    // including the ones that never render pagination controls.
    if (this.paginator) {
      return this.paginator.renderCurrentPage({ disabled: true });
    }

    return this.renderScreen({ disabled: true });
  }

  /**
   * The paginator's `update()` sends only the container this returns, so it
   * must be the whole frame — chrome assembled outside it is wiped on every
   * page turn.
   */
  private renderContainer(opts: RenderOptions): ContainerBuilder {
    return this.renderScreen(opts).components[0];
  }

  private renderScreen(opts: RenderOptions): ModViewMessage {
    return createModViewMessage({
      user: this.targetUser,
      member: this.targetMember,
      standing: this.data.standing,
      activeTab: this.activeTab,
      disabled: opts.disabled,
      navButtons: opts.navButtons ?? null,
      tabContentOptions: {
        data: this.data,
        disabled: opts.disabled,
        user: this.targetUser,
        member: this.targetMember,
        guildId: this.interaction.guildId,
        emojis: this.emojis,
        includeAlts: this.includeAlts,
        historyPageCases: opts.historyPageCases,
        lookupPageBans: opts.lookupPageBans,
      },
    });
  }
}

interface RenderOptions {
  disabled: boolean;
  navButtons?: ActionRowBuilder<ButtonBuilder> | null;
  historyPageCases?: ModerationCase[];
  lookupPageBans?: UserLookupBan[];
}

/**
 * Resolves the target's member once at entry. Held for the session rather
 * than re-fetched per tab: a `ButtonInteraction` cannot re-resolve it, and a
 * fetch per navigation adds a fallible round-trip to every click.
 */
export async function fetchTargetMember(
  guild: Guild,
  userId: string,
  logger: Logger,
): Promise<GuildMember | null> {
  try {
    return await guild.members.fetch(userId);
  } catch (err) {
    logger.debug({ err, userId }, "Mod view target is not a guild member");
    return null;
  }
}

/**
 * Loads the view's data and opens the session. Throws on infrastructure
 * failure — the entry points catch and respond, per the layering rule that
 * only presentation handles a throw.
 */
export async function openModView(
  interaction: ModViewEntryInteraction,
  targetUser: User,
  deps: ModViewDependencies,
  initialTab: ModViewTab = "overview",
): Promise<void> {
  const member = await fetchTargetMember(
    interaction.guild,
    targetUser.id,
    deps.logger,
  );

  const result = await deps.modViewService.getModView(
    interaction.guildId,
    targetUser.id,
    member,
  );

  if (!result.ok) {
    await interaction.reply(
      getErrorMessage("Failed to open mod view", result.val),
    );
    return;
  }

  const emojis = await deps.emojiRepository.getEmojis(HISTORY_ACTION_EMOJIS);

  const session = new ModViewSession(
    interaction,
    result.val,
    targetUser,
    member,
    emojis,
    deps.setNicknameService,
    deps.logger,
    initialTab,
  );

  await session.start();
}

/** Single error response for a thrown failure, at whichever stage it happened. */
export async function respondWithModViewError(
  interaction: ModViewEntryInteraction,
  description: string,
): Promise<void> {
  const message = getErrorMessage("Failed to open mod view", description);

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(message);
    return;
  }

  await interaction.reply(message);
}

/**
 * Shared entry-point wrapper for every deep-linking command: opens the view
 * on the given tab and converts a thrown infrastructure error into a reply,
 * per the layering rule that only presentation handles a throw.
 */
export async function openModViewOrReportError(
  interaction: ModViewEntryInteraction,
  targetUser: User,
  deps: ModViewDependencies,
  initialTab: ModViewTab,
  log: Logger,
): Promise<void> {
  try {
    await openModView(interaction, targetUser, deps, initialTab);
  } catch (err) {
    log.error(
      { err, guildId: interaction.guildId, targetId: targetUser.id },
      "Failed to open mod view",
    );
    await respondWithModViewError(
      interaction,
      "Something went wrong loading this user's moderation data.",
    );
  }
}
