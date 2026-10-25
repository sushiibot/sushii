import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  escapeMarkdown,
} from "discord.js";

import customIds from "@/interactions/customIds";

import { SCREENING_RULES } from "../../domain/rules";
import type {
  AutomodSummary,
  IgnoreReason,
  JudgedText,
  ScreeningVerdict,
} from "../../domain/types";

const HIGH_THRESHOLD = 0.85;
const BAR_CELLS = 10;
const LINE_MAX = 300;
const ACCENT_OPEN = 0xf0b232;
const ACCENT_ACTIONED = 0xf23f43;

const ANSI_RED = "\u001b[1;31m";
const ANSI_YELLOW = "\u001b[1;33m";
const ANSI_RESET = "\u001b[0m";

export const IGNORE_REASON_OPTIONS: readonly {
  value: IgnoreReason;
  label: string;
  description: string;
}[] = [
  {
    value: "too_minor",
    label: "Too minor",
    description: "Real, but not worth a review",
  },
  {
    value: "allowed_here",
    label: "Allowed here",
    description: "This server permits it",
  },
  {
    value: "not_violation",
    label: "Not a violation",
    description: "The model got it wrong",
  },
  {
    value: "wrong_category",
    label: "Wrong category",
    description: "A real problem, wrong label",
  },
];

/** One aligned line per rule on a fixed 10-cell track. █/░ keep full contrast without color
 *  (Discord mobile renders no ANSI), and ◀ marks rules at or over the review threshold there.
 *  Colors are a desktop-only extra. */
export function scoreBars(
  scores: Record<string, number>,
  reviewThreshold: number,
): string {
  const ids = orderedRuleIds(scores);
  const width = Math.max(0, ...ids.map((id) => id.length)) + 1;
  const lines = ids.map((id) => {
    const p = scores[id] ?? 0;
    const filled = Math.min(BAR_CELLS, Math.max(0, Math.round(p * BAR_CELLS)));
    let color = "";
    if (p >= Math.max(HIGH_THRESHOLD, reviewThreshold)) {
      color = ANSI_RED;
    } else if (p >= reviewThreshold) {
      color = ANSI_YELLOW;
    }
    const marker = p >= reviewThreshold ? " ◀" : "";
    const line = `${id.padEnd(width)}${p.toFixed(2)} ${"█".repeat(filled)}${"░".repeat(BAR_CELLS - filled)}${marker}`;
    return color ? `${color}${line}${ANSI_RESET}` : line;
  });
  return "```ansi\n" + lines.join("\n") + "\n```";
}

/** Current rules in definition order, then ids only older verdicts carry (retired rules). */
function orderedRuleIds(scores: Record<string, number>): string[] {
  const known: string[] = SCREENING_RULES.map((r) => r.id).filter(
    (id) => scores[id] !== undefined,
  );
  return [...known, ...Object.keys(scores).filter((id) => !known.includes(id))];
}

export function verdictRef(id: number): string {
  return `scr-${id}`;
}

function escapeName(name: string): string {
  return escapeMarkdown(name, { maskedLink: true });
}

function oneLine(text: string): string {
  const flat = Array.from(text.replace(/\s*\n\s*/g, " ⏎ ").trim());
  return flat.length > LINE_MAX
    ? `${flat.slice(0, LINE_MAX - 1).join("")}…`
    : flat.join("");
}

function titleFor(verdict: ScreeningVerdict): string {
  if (verdict.kind === "text") {
    const rule = SCREENING_RULES.find((r) => r.id === verdict.topRule);
    return `### ⚠️ Suspicious message · likely ${rule?.title ?? verdict.topRule ?? "rule violation"}`;
  }
  const cats = verdict.categories ?? [];
  const what = verdict.kind === "pfp" ? "profile picture" : "image link";
  const suffix = cats.length ? ` · ${cats.join(", ").toLowerCase()}` : "";
  return `### ⚠️ Suspicious ${what}${suffix}`;
}

function whoLines(verdict: ScreeningVerdict, automod?: AutomodSummary): string {
  const joined = verdict.joinedAt
    ? `joined <t:${Math.floor(verdict.joinedAt.getTime() / 1000)}:R> · `
    : "";
  const ordinal = verdict.ordinal
    ? `message #${verdict.ordinal} since join · `
    : "";
  const deleted = verdict.messageDeleted ? " · **message deleted**" : "";
  let blocked = "";
  if (automod && automod.count > 0) {
    const noun = automod.count === 1 ? "message" : "messages";
    const rules = automod.rules.length ? ` (${automod.rules.join(", ")})` : "";
    blocked = `\n-# 🛡️ ${automod.count} ${noun} blocked by AutoMod${rules}`;
  }
  return `<@${verdict.userId}> (\`${verdict.userId}\`)\n-# ${joined}${ordinal}in <#${verdict.channelId}>${deleted}${blocked}`;
}

function outcomeText(verdict: ScreeningVerdict): string {
  const by = verdict.outcomeBy ? ` by <@${verdict.outcomeBy}>` : "";
  if (verdict.outcome === "ignored") {
    const reason = IGNORE_REASON_OPTIONS.find(
      (o) => o.value === verdict.ignoreReason,
    );
    return ` · ignored${by}${reason ? ` · ${reason.label.toLowerCase()}` : ""}`;
  }
  if (verdict.outcome === "actioned") {
    return ` · 🔨 ${verdict.outcomeAction ?? "actioned"}${by}`;
  }
  return "";
}

function footer(verdict: ScreeningVerdict): string {
  return `-# \`${verdictRef(verdict.id)}\`${outcomeText(verdict)}`;
}

function separator(): SeparatorBuilder {
  return new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Small);
}

function judgedText(verdict: ScreeningVerdict): JudgedText {
  if (verdict.judged && "target" in verdict.judged) {
    return verdict.judged;
  }
  return { context: [], target: [] };
}

function judgedReason(verdict: ScreeningVerdict): string | undefined {
  if (verdict.judged && "reason" in verdict.judged) {
    return verdict.judged.reason;
  }
  return undefined;
}

function addTextBody(
  container: ContainerBuilder,
  verdict: ScreeningVerdict,
  reviewThreshold: number,
): void {
  const judged = judgedText(verdict);
  const lines = [
    ...judged.context.map(
      (l) => `-# ${escapeName(l.author)}: ${oneLine(l.text)}`,
    ),
    ...judged.target.map(
      (l) => `> **${escapeName(l.author)}:** ${oneLine(l.text)}`,
    ),
  ];
  const scores: Record<string, number> = {};
  for (const [id, p] of Object.entries(verdict.scores ?? {})) {
    if (p !== undefined) {
      scores[id] = p;
    }
  }
  container
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(lines.join("\n") || "-# (no text)"),
    )
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${scoreBars(scores, reviewThreshold)}\n${footer(verdict)}`,
      ),
    );
}

function addImageBody(
  container: ContainerBuilder,
  verdict: ScreeningVerdict,
): void {
  if (verdict.kind === "image" && verdict.sourceUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(verdict.sourceUrl)
          .setSpoiler(true),
      ),
    );
  }
  const reason = judgedReason(verdict);
  const why = reason ? `> ${oneLine(reason)}\n` : "";
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`${why}${footer(verdict)}`),
  );
}

function actionButton(
  verdict: ScreeningVerdict,
  actionType: "timeout" | "untimeout" | "ban" | "unban",
  label: string,
  style: ButtonStyle.Secondary | ButtonStyle.Danger,
): ButtonBuilder {
  return new ButtonBuilder()
    .setStyle(style)
    .setLabel(label)
    .setCustomId(
      customIds.screeningAction.compile({
        actionType,
        verdictId: verdict.id.toString(),
      }),
    );
}

function addControls(
  container: ContainerBuilder,
  verdict: ScreeningVerdict,
): void {
  const jump = new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setLabel("Jump to message")
    .setURL(
      `https://discord.com/channels/${verdict.guildId}/${verdict.channelId}/${verdict.messageId}`,
    );

  const buttons: ButtonBuilder[] = [];
  if (verdict.outcome === null) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(
        customIds.screeningIgnore.compile({
          verdictId: verdict.id.toString(),
        }),
      )
      .setPlaceholder("Ignore…")
      .addOptions(
        IGNORE_REASON_OPTIONS.map((o) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(o.label)
            .setValue(o.value)
            .setDescription(o.description),
        ),
      );
    container.addActionRowComponents(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    );
    buttons.push(
      actionButton(verdict, "timeout", "Timeout", ButtonStyle.Secondary),
      actionButton(verdict, "ban", "Ban", ButtonStyle.Danger),
    );
  } else if (verdict.outcome === "actioned") {
    const action = verdict.outcomeAction ?? "";
    if (action === "banned") {
      buttons.push(
        actionButton(verdict, "unban", "Unban", ButtonStyle.Secondary),
      );
    } else if (action.startsWith("timed out")) {
      buttons.push(
        actionButton(
          verdict,
          "untimeout",
          "Remove timeout",
          ButtonStyle.Secondary,
        ),
        actionButton(verdict, "ban", "Ban", ButtonStyle.Danger),
      );
    }
  }
  buttons.push(jump);
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(buttons),
  );
}

/** Rebuilt from the stored verdict on every edit (ignore, mod action, delete), so the post never
 *  depends on the original message still existing. */
export function buildScreeningPost(
  verdict: ScreeningVerdict,
  opts: { reviewThreshold: number; automod?: AutomodSummary },
): ContainerBuilder {
  if (verdict.kind === "automod" || verdict.kind === "miss") {
    throw new Error("Screening verdict kind is never posted", {
      cause: { verdictId: verdict.id, kind: verdict.kind },
    });
  }

  const container = new ContainerBuilder();
  if (verdict.outcome === "actioned") {
    container.setAccentColor(ACCENT_ACTIONED);
  } else if (verdict.outcome === null) {
    container.setAccentColor(ACCENT_OPEN);
  }

  const header = `${titleFor(verdict)}\n${whoLines(verdict, opts.automod)}`;
  if (verdict.kind === "pfp" && verdict.sourceUrl) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(header))
        .setThumbnailAccessory(
          new ThumbnailBuilder().setURL(verdict.sourceUrl).setSpoiler(true),
        ),
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(header),
    );
  }

  if (verdict.kind === "text") {
    addTextBody(container, verdict, opts.reviewThreshold);
  } else {
    addImageBody(container, verdict);
  }

  addControls(container, verdict);
  return container;
}
