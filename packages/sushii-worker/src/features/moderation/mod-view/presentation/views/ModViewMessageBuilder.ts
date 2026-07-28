import type {
  ActionRowBuilder,
  ButtonBuilder,
  GuildMember,
  InteractionReplyOptions,
  User,
} from "discord.js";
import { ContainerBuilder, MessageFlags, SeparatorBuilder } from "discord.js";

import type { EmojiMap } from "@/features/bot-emojis";
import type { UserLookupBan } from "@/features/moderation/cases/domain/entities/UserLookupBan";
import type { HISTORY_ACTION_EMOJIS } from "@/features/moderation/cases/presentation/views/HistoryView";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { ComponentsV2Paginator } from "@/shared/presentation/ComponentsV2Paginator";
import Color from "@/utils/colors";

import type {
  ModViewResult,
  ModViewStanding,
} from "../../application/ModViewService";
import { addChrome } from "./components/ModViewChrome";
import type { ModViewTab } from "./components/ModViewChrome";
import { addAltsTabContent } from "./tabs/AltsTabBuilder";
import { addHistoryTabContent } from "./tabs/HistoryTabBuilder";
import { addLookupTabContent } from "./tabs/LookupTabBuilder";
import { addNamesTabContent } from "./tabs/NamesTabBuilder";
import { addOverviewTabContent } from "./tabs/OverviewTabBuilder";

/** Idle window before the collector ends and the view renders disabled. */
export const MODVIEW_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

const MODVIEW_EXPIRED_FOOTER = `-# Session expired after ${MODVIEW_IDLE_TIMEOUT_MS / 60_000} minutes of inactivity. Re-run the command.`;

/**
 * Everything a tab content builder needs. Shared across all five tabs rather
 * than one shape per tab (mirrors `SettingsMessageOptions` /
 * `add*Content(container, options)` in `SettingsMessageBuilder.ts`) so
 * `createModViewMessage` can switch on `activeTab` without importing a
 * different options type per case.
 *
 * `data` is the full, once-resolved `ModViewResult` — no per-tab re-fetch.
 * Per-tab transient UI state (history page slice, alt filter toggle,
 * names/lookup page) lives in the optional fields below.
 */
export interface ModViewTabContentOptions {
  data: ModViewResult;
  disabled: boolean;
  /** The target user — Names needs the live `globalName` to mark "· current" entries (`UserInfo` deliberately omits it). */
  user: User;
  /** The target's member in this guild, if present — Names needs the live nickname for the same reason. */
  member: GuildMember | null;
  /** Scopes Names' nickname entries to this guild — not part of `ModViewResult`, only a parameter to `getModView`. */
  guildId: string;
  emojis: EmojiMap<typeof HISTORY_ACTION_EMOJIS>;
  /** History's current page slice, oldest-at-top. Defaults to `buildHistoryTabPages`' first page when omitted. */
  historyPageCases?: ModerationCase[];
  /** Defaults to `true` — all linked accounts shown. */
  includeAlts?: boolean;
  /** Lookup's current page slice. Defaults to `chunkLookupBans`' first page when omitted. */
  lookupPageBans?: UserLookupBan[];
}

export type ModViewTabContentBuilder = (
  container: ContainerBuilder,
  options: ModViewTabContentOptions,
) => void;

export interface ModViewMessageOptions {
  user: User;
  member: GuildMember | null;
  standing: ModViewStanding | null;
  activeTab: ModViewTab;
  disabled: boolean;
  tabContentOptions: ModViewTabContentOptions;
  /** Non-null only for the paginated tabs (History, Lookup). */
  navButtons?: ActionRowBuilder<ButtonBuilder> | null;
}

/**
 * Builds one Mod View screen: chrome first (header then tab row), a
 * separator, then the active tab's content, then a separator, then the
 * paginator row or expiry footer.
 *
 * Called both for the initial reply and from inside a paginated tab's
 * `renderContainer` callback — never call `ComponentsV2Paginator.start()`
 * from the mod-view collector, it double-replies (the view has already
 * replied by the time a tab is opened).
 */
export function createModViewMessage(
  options: ModViewMessageOptions,
): InteractionReplyOptions & {
  flags: MessageFlags.IsComponentsV2;
  components: ContainerBuilder[];
} {
  const container = new ContainerBuilder().setAccentColor(Color.Info);

  addChrome(
    container,
    options.user,
    options.member,
    options.standing,
    options.activeTab,
    options.disabled,
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  switch (options.activeTab) {
    case "overview":
      addOverviewTabContent(container, options.tabContentOptions);
      break;
    case "history":
      addHistoryTabContent(container, options.tabContentOptions);
      break;
    case "alts":
      addAltsTabContent(container, options.tabContentOptions);
      break;
    case "names":
      addNamesTabContent(container, options.tabContentOptions);
      break;
    case "lookup":
      addLookupTabContent(container, options.tabContentOptions);
      break;
  }

  if (options.disabled || options.navButtons) {
    container.addSeparatorComponents(new SeparatorBuilder());
  }

  // Not `addNavigationSection`: its default expiry copy states a 2-minute
  // idle window, which this view does not use.
  if (options.disabled) {
    ComponentsV2Paginator.addExpiredFooter(container, MODVIEW_EXPIRED_FOOTER);
  }

  if (options.navButtons) {
    container.addActionRowComponents(options.navButtons);
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      parse: [],
    },
  };
}
