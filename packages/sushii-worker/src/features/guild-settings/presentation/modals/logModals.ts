import { ModalBuilder } from "discord.js";

import type { LogType, SettingsPatch } from "../../application/SettingsPatch";
import { settingsIds } from "../session/settingsIds";
import { compareSnowflakes } from "../utils/compareSnowflakes";
import type { ModalContext, ModalSubmission } from "./ModalContext";
import {
  FIELD,
  MAX_IGNORED_CHANNELS,
  channelHint,
  channelSelectLabel,
  prefillChannel,
  readChannel,
  readChannels,
} from "./modalFields";

export type LogTarget = "modlog" | "memberlog" | "msglog" | "reactionlog";

const LOGS: Record<
  LogTarget,
  {
    log: LogType;
    title: string;
    what: string;
    channel: (ctx: ModalContext) => string | null;
  }
> = {
  modlog: {
    log: "mod",
    title: "Mod log",
    what: "Where bans, kicks, timeouts and warnings are logged.",
    channel: (ctx) => ctx.config.loggingSettings.modLogChannel,
  },
  memberlog: {
    log: "member",
    title: "Member log",
    what: "Where joins and leaves are logged.",
    channel: (ctx) => ctx.config.loggingSettings.memberLogChannel,
  },
  msglog: {
    log: "message",
    title: "Message log",
    what: "Where edits and deletes are logged.",
    channel: (ctx) => ctx.config.loggingSettings.messageLogChannel,
  },
  reactionlog: {
    log: "reaction",
    title: "Reaction log",
    what: "Where removed reactions are logged.",
    channel: (ctx) => ctx.config.loggingSettings.reactionLogChannel,
  },
};

function hiddenIgnoredChannels(ctx: ModalContext): string[] {
  const shown = new Set(ctx.prefilledIgnoredChannelIds);
  return ctx.ignoredChannelIds
    .filter((id) => !shown.has(id))
    .sort(compareSnowflakes);
}

export function buildLogModal(
  target: LogTarget,
  ctx: ModalContext,
): ModalBuilder {
  const spec = LOGS[target];
  const state = ctx.status.logging[target];
  const channelId = prefillChannel(state, spec.channel(ctx));

  const modal = new ModalBuilder()
    .setCustomId(settingsIds.modal(target))
    .setTitle(spec.title)
    .addLabelComponents(
      channelSelectLabel({
        label: "Channel",
        description: `${spec.what} ${channelHint(state, channelId)}`,
        defaults: channelId ? [channelId] : [],
      }),
    );

  if (target === "msglog") {
    const hidden = hiddenIgnoredChannels(ctx);
    modal.addLabelComponents(
      channelSelectLabel({
        label: "Ignored channels",
        description:
          hidden.length > 0
            ? `Busy channels to skip. +${hidden.length} more not shown; they're kept.`
            : "Busy channels to skip",
        customId: FIELD.ignored,
        defaults: ctx.prefilledIgnoredChannelIds,
        maxValues: MAX_IGNORED_CHANNELS,
      }),
    );
  }

  return modal;
}

export function parseLogModal(
  target: LogTarget,
  submission: ModalSubmission,
  ctx: ModalContext,
): SettingsPatch[] {
  const patches: SettingsPatch[] = [
    {
      kind: "logChannel",
      log: LOGS[target].log,
      channelId: readChannel(submission),
    },
  ];

  if (target === "msglog") {
    patches.push({
      kind: "messageLogIgnored",
      channelIds: [
        ...new Set([
          ...readChannels(submission, FIELD.ignored),
          ...hiddenIgnoredChannels(ctx),
        ]),
      ],
    });
  }

  return patches;
}
