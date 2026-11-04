import {
  ActionRowBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
} from "discord.js";

import type { HistoryEmojis } from "@/features/moderation/cases/presentation/views/HistoryView";
import type { CaseProof } from "@/features/moderation/shared/domain/entities/CaseProof";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import type { CaseProofRepository } from "@/features/moderation/shared/domain/repositories/CaseProofRepository";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import {
  addProofButton,
  proofEntryText,
  proofFileLinks,
  proofHeading,
  proofMediaUrls,
} from "@/features/moderation/shared/presentation/proof/proofBlock";
import {
  alsoIncludedLine,
  reasonDelivery,
  reasonHeading,
  serverDmTextIncluded,
  withEmoji,
} from "@/features/moderation/shared/presentation/proof/reasonBlock";
import {
  formatActionTypeAsSentence,
  getActionTypeBotEmoji,
  getActionTypeColor,
} from "@/features/moderation/shared/presentation/views/ActionTypeFormatter";
import dayjs from "@/shared/domain/dayjs";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";
import Color from "@/utils/colors";
import { truncateText } from "@/utils/truncateText";

import { MODVIEW_CUSTOM_IDS } from "../customIds";

const SELECT_MAX_OPTIONS = 25;
const SELECT_TEXT_MAX_LENGTH = 100;

/** Discord's cap on all Text Display content in one message. */
export const CASE_VIEW_TEXT_MAX = 4000;

const CONTINUED_LINE = "-# Continued below";

/** Marks the first case view message, so Add proof knows to rebuild it. */
export const CASE_VIEW_CONTAINER_ID = 4001;

const NO_PROOF_LINE =
  "-# None yet. Add screenshots, message links or context for other mods.";

/** Opens any case on the current page; null for an empty page. */
export function buildCaseSelect(
  pageCases: readonly ModerationCase[],
  emojis: HistoryEmojis,
  disabled: boolean,
  now: Date = new Date(),
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  if (pageCases.length === 0) {
    return null;
  }

  const options = pageCases.slice(0, SELECT_MAX_OPTIONS).map((c) => {
    const age = dayjs(c.actionTime).from(now);
    const option = new StringSelectMenuOptionBuilder()
      .setValue(c.caseId)
      .setLabel(
        truncateText(
          `#${c.caseId} ${formatActionTypeAsSentence(c.actionType)} · ${age}`,
          SELECT_TEXT_MAX_LENGTH,
        ),
      );

    const reason = c.reason?.value.replace(/\s+/g, " ").trim();
    if (reason) {
      option.setDescription(truncateText(reason, SELECT_TEXT_MAX_LENGTH));
    }

    const emoji = emojis[getActionTypeBotEmoji(c.actionType)];
    if (emoji) {
      option.setEmoji(emoji);
    }

    return option;
  });

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(MODVIEW_CUSTOM_IDS.historyCase)
      .setPlaceholder("View case…")
      .setDisabled(disabled)
      .addOptions(options),
  );
}

export interface CaseViewOptions {
  /** Whether the DM carried the server's custom text for this action. */
  serverDmTextIncluded: boolean;
}

function headerText(moderationCase: ModerationCase, emojis: HistoryEmojis) {
  const emoji = emojis[getActionTypeBotEmoji(moderationCase.actionType)];
  const title = `${formatActionTypeAsSentence(moderationCase.actionType)} · Case #${moderationCase.caseId}`;
  const by = moderationCase.executorId
    ? ` · by <@${moderationCase.executorId}>`
    : "";
  const at = dayjs.utc(moderationCase.actionTime).unix();

  return `### ${withEmoji(emoji, title)}\n<@${moderationCase.userId}>${by} · <t:${at}:R>`;
}

function reasonText(
  moderationCase: ModerationCase,
  emojis: HistoryEmojis,
  opts: CaseViewOptions,
): string {
  const reason = moderationCase.reason?.value;

  if (moderationCase.actionType === ActionType.Note) {
    const heading = `**${withEmoji(emojis.lock, "Note")}** · mods only`;
    return `${heading}\n${reason ?? "-# No text"}`;
  }

  const delivery = reasonDelivery(moderationCase);
  const heading = reasonHeading(
    emojis,
    delivery.sent
      ? { sent: true, to: "user" }
      : { sent: false, why: delivery.why ?? undefined },
  );

  let s = `${heading}\n${reason ?? "-# No reason given"}`;
  if (delivery.sent && opts.serverDmTextIncluded) {
    s += `\n-# ${alsoIncludedLine(moderationCase.actionType)}`;
  }

  return s;
}

/** How many entries fit, each joined with "\n", after `used` chars. */
function packEntries(
  entries: readonly string[],
  used: number,
  budget: number,
): number {
  let count = 0;
  for (const entry of entries) {
    const cost = entry.length + 1;
    if (used + cost > budget) {
      break;
    }
    used += cost;
    count++;
  }

  return count;
}

const QUOTE_PREFIX = "> ";

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** Cuts one line into pieces of at most `max` chars, re-quoting quoted lines. */
function cutLongLine(line: string, max: number): string[] {
  const quoted = line.startsWith(QUOTE_PREFIX) && max > QUOTE_PREFIX.length + 1;
  const minCut = quoted ? QUOTE_PREFIX.length + 1 : 1;
  const pieces: string[] = [];

  let rest = line;
  while (rest.length > max) {
    let cut = max;
    for (let i = max - 1; i >= minCut; i--) {
      if (/\s/.test(rest[i])) {
        cut = i + 1;
        break;
      }
    }
    if (cut === max && isHighSurrogate(rest.charCodeAt(cut - 1))) {
      cut--;
    }

    pieces.push(rest.slice(0, cut));
    rest = (quoted ? QUOTE_PREFIX : "") + rest.slice(cut);
  }

  pieces.push(rest);
  return pieces;
}

/**
 * Cuts text into pieces of at most `max` chars at line breaks, cutting inside
 * a line only when that line alone is too long, at its last space if any.
 */
export function splitAtLines(text: string, max: number): string[] {
  if (max < 2) {
    throw new Error("splitAtLines needs max >= 2", { cause: { max } });
  }

  const pieces: string[] = [];
  let current: string | null = null;

  for (const line of text.split("\n")) {
    if (current !== null && current.length + 1 + line.length <= max) {
      current += "\n" + line;
      continue;
    }
    if (current !== null) {
      pieces.push(current);
    }
    if (line.length > max) {
      const cut = cutLongLine(line, max);
      pieces.push(...cut.slice(0, -1));
      current = cut[cut.length - 1];
    } else {
      current = line;
    }
  }

  if (current) {
    pieces.push(current);
  }

  return pieces;
}

function moreProofHeading(
  moderationCase: ModerationCase,
  emojis: HistoryEmojis,
): string {
  return `**${withEmoji(emojis.lock, `More proof · Case #${moderationCase.caseId}`)}**`;
}

function caseViewMessage(container: ContainerBuilder) {
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  } as const;
}

export type CaseViewMessage = ReturnType<typeof caseViewMessage>;

/**
 * Read-only private view of one case: the reason as the user got it, then
 * every proof entry in full. Proof that would push past Discord's text cap
 * moves to follow-up messages rather than being cut.
 */
export function buildCaseViewMessages(
  moderationCase: ModerationCase,
  proofs: readonly CaseProof[],
  emojis: HistoryEmojis,
  opts: CaseViewOptions,
): CaseViewMessage[] {
  const header = headerText(moderationCase, emojis);
  const reason = reasonText(moderationCase, emojis, opts);
  const heading = proofHeading(emojis);
  const entries = proofs.map((p) => proofEntryText(p, emojis));
  const media = proofMediaUrls(proofs);
  const links = proofFileLinks(proofs);
  const linksText = links.join("\n");

  const fixed = header.length + reason.length + heading.length;
  const shown = packEntries(entries, fixed, CASE_VIEW_TEXT_MAX);
  const spilled = entries.slice(shown);

  let sectionText: string;
  if (entries.length === 0) {
    sectionText = `${heading}\n${NO_PROOF_LINE}`;
  } else if (shown === 0) {
    sectionText = `${heading}\n${CONTINUED_LINE}`;
  } else {
    sectionText = [heading, ...entries.slice(0, shown)].join("\n");
  }

  // Links stay with the gallery unless proof already spilled or they'd overflow.
  const linksOnFirst =
    links.length > 0 &&
    spilled.length === 0 &&
    fixed + (sectionText.length - heading.length) + linksText.length <=
      CASE_VIEW_TEXT_MAX;

  const accent = getActionTypeColor(moderationCase.actionType) ?? Color.Info;
  const container = new ContainerBuilder()
    .setId(CASE_VIEW_CONTAINER_ID)
    .setAccentColor(accent)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(header))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(reason))
    .addSeparatorComponents(new SeparatorBuilder())
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(sectionText),
        )
        .setButtonAccessory(addProofButton([moderationCase.caseId], emojis)),
    );

  if (media.length > 0) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        media.map((url) => new MediaGalleryItemBuilder().setURL(url)),
      ),
    );
  }

  if (linksOnFirst) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(linksText),
    );
  }

  const messages = [caseViewMessage(container)];

  const moreHeading = moreProofHeading(moderationCase, emojis);
  const pieceMax = CASE_VIEW_TEXT_MAX - moreHeading.length - 1;
  const overflow = (
    linksOnFirst || links.length === 0 ? spilled : [...spilled, linksText]
  ).flatMap((entry) =>
    entry.length > pieceMax ? splitAtLines(entry, pieceMax) : [entry],
  );

  let rest = overflow;
  while (rest.length > 0) {
    const take = Math.max(
      1,
      packEntries(rest, moreHeading.length, CASE_VIEW_TEXT_MAX),
    );
    const text = [moreHeading, ...rest.slice(0, take)].join("\n");
    messages.push(
      caseViewMessage(
        new ContainerBuilder()
          .setAccentColor(accent)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(text)),
      ),
    );
    rest = rest.slice(take);
  }

  return messages;
}

export interface CaseViewSources {
  caseProofRepository: Pick<CaseProofRepository, "listByCase">;
  guildConfigRepository: Pick<GuildConfigRepository, "findByGuildId">;
}

/** The case view from the case's current proof and the server's DM settings. */
export async function loadCaseViewMessages(
  moderationCase: ModerationCase,
  emojis: HistoryEmojis,
  sources: CaseViewSources,
): Promise<CaseViewMessage[]> {
  const [proofs, guildConfig] = await Promise.all([
    sources.caseProofRepository.listByCase(
      moderationCase.guildId,
      moderationCase.caseId,
    ),
    sources.guildConfigRepository.findByGuildId(moderationCase.guildId),
  ]);
  return buildCaseViewMessages(moderationCase, proofs, emojis, {
    serverDmTextIncluded: serverDmTextIncluded(moderationCase, guildConfig),
  });
}

/** Whether posted components are a case view's first message. */
export function isCaseViewMessage(
  components: readonly { id?: number }[],
): boolean {
  return components.some((c) => c.id === CASE_VIEW_CONTAINER_ID);
}
