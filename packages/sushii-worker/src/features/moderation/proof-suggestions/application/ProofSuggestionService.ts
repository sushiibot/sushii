import { sleep } from "bun";
import { SnowflakeUtil } from "discord.js";
import type { GuildMember } from "discord.js";
import type { Logger } from "pino";

import type { MessageLogBlockRepository } from "@/features/message-log/domain/repositories/MessageLogBlockRepository";
import type {
  MessageLogPost,
  MessageLogPostRepository,
} from "@/features/message-log/domain/repositories/MessageLogPostRepository";
import type { MessageData } from "@/features/message-log/domain/types/MessageData";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import {
  MAX_AUTOMOD_SUGGESTIONS,
  MAX_SUGGESTIONS,
  MAX_TARGET_MESSAGES,
  SUGGESTION_WINDOW_MS,
} from "../domain/ProofSuggestion";
import type { ProofSuggestion } from "../domain/ProofSuggestion";
import type {
  CachedMessage,
  ProofSuggestionMessageRepository,
} from "../domain/ProofSuggestionMessageRepository";
import {
  AUTOMOD_ALERT_MESSAGE_TYPE,
  parseAutomodAlert,
} from "../domain/automodAlert";
import { messageUrl } from "../domain/proofContent";
import type {
  ResolvedLink,
  ResolvedSuggestionLinks,
  SkippedMessage,
} from "../domain/proofContent";
import { toSnippet } from "../domain/snippet";
import type {
  PreviewAuthor,
  PreviewMessage,
  PreviewRequest,
} from "../infrastructure/preview/types";
import type {
  MessageExistence,
  MessageExistenceChecker,
} from "./MessageExistenceChecker";
import { viewerAccessFromMember } from "./viewerAccess";
import type { ViewerAccess } from "./viewerAccess";

export interface FindSuggestionsInput {
  guildId: string;
  targetId: string;
  actionTime: Date;
  viewer: GuildMember;
  savedMessageLinks?: readonly string[];
}

export interface ResolveLinksOptions {
  guildId: string;
  actionKind: ActionType;
  actionTime: Date;
  /**
   * How far back the action deleted the target's messages. null, 0 or unset: nothing was purged,
   * so a fresh action doesn't wait for log posts and a missing message is deleted, not pending.
   */
  purgeWindowSeconds?: number | null;
  /** Set for native bans, where Discord doesn't report the window: wait, and any missing message is pending. Wins over purgeWindowSeconds. */
  purgeWindowUnknown?: boolean;
}

export interface PreviewContext {
  guildId: string;
  targetId: string;
  viewer: GuildMember;
  /** Used for the subtitle and app replies the target triggered; derived from cached rows otherwise. */
  targetDisplayName?: string;
}

/** Actions that purge messages, so their deletes may still be reaching the message log. */
const PURGE_ACTIONS = new Set<ActionType>([
  ActionType.Ban,
  ActionType.TempBan,
  ActionType.Softban,
]);
const FRESH_PURGE_MS = 10_000;
const PURGE_WAIT_MS = 5_000;
const PURGE_POLL_MS = 250;

const AUTOMOD_CANDIDATES = 20;
const CONTEXT_PER_GAP = 2;
const CONTEXT_LOOKBACK_MS = 30 * 60 * 1000;
const CONTEXT_ROW_LIMIT = 200;

export interface ProofSuggestionServiceDeps {
  messages: ProofSuggestionMessageRepository;
  logPosts: MessageLogPostRepository;
  logBlocks: MessageLogBlockRepository;
  guildConfigs: GuildConfigRepository;
  existence: MessageExistenceChecker;
  logger: Logger;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function displayName(msg: MessageData): string {
  return msg.member?.nick ?? msg.author.global_name ?? msg.author.username;
}

function formatClock(date: Date): string {
  return date.toISOString().slice(11, 16);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export class ProofSuggestionService {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private loggedUnparsedAlert = false;

  constructor(private readonly deps: ProofSuggestionServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? sleep;
  }

  async find(input: FindSuggestionsInput): Promise<ProofSuggestion[]> {
    return this.findWithAccess(
      input,
      viewerAccessFromMember(input.viewer, this.deps.logger),
    );
  }

  async findWithAccess(
    input: Omit<FindSuggestionsInput, "viewer">,
    access: ViewerAccess,
  ): Promise<ProofSuggestion[]> {
    const { guildId, targetId, actionTime } = input;

    // Cached rows of deleted messages may only surface through message log posts.
    if (!(await this.messageLogEnabled(guildId))) {
      return [];
    }

    const range = {
      from: new Date(actionTime.getTime() - SUGGESTION_WINDOW_MS),
      to: actionTime,
    };

    const blocked = new Set(
      (await this.deps.logBlocks.findByGuildId(guildId)).map(
        (b) => b.channelId,
      ),
    );
    const allowed = (channelId: string) => !blocked.has(channelId);

    const logChannelIds = await this.deps.messages.findTargetLogChannelIds(
      guildId,
      targetId,
      range,
    );
    await access.prepare(logChannelIds);
    // Filtered in SQL so hidden deleted messages neither count nor take a slot in the cap.
    const hiddenLogChannels = logChannelIds.filter((id) => !access.canView(id));

    const [counts, alertRows] = await Promise.all([
      this.deps.messages.countTargetMessagesByChannel(
        guildId,
        targetId,
        range,
        hiddenLogChannels,
      ),
      this.deps.messages.findTargetAutomodAlerts(
        guildId,
        targetId,
        range,
        AUTOMOD_CANDIDATES,
      ),
    ]);
    await access.prepare([
      ...counts.keys(),
      ...alertRows.map((r) => r.channelId),
    ]);

    const readableChannels = [...counts.keys()].filter(
      (id) => allowed(id) && access.canRead(id),
    );

    const messages = await this.deps.messages.findLatestTargetMessages(
      guildId,
      targetId,
      range,
      readableChannels,
      hiddenLogChannels,
      MAX_TARGET_MESSAGES,
    );

    const posts = await this.postsById(guildId, [
      ...messages.map((m) => m.id),
      ...alertRows.map((a) => a.id),
    ]);
    await access.prepare([...posts.values()].map((p) => p.logChannelId));
    const loggedOutOfView = (id: string) => {
      const post = posts.get(id);
      return post !== undefined && !access.canView(post.logChannelId);
    };
    const saved = new Set(input.savedMessageLinks);
    const alreadySaved = (row: CachedMessage) => {
      const post = posts.get(row.id);
      return (
        saved.has(messageUrl(guildId, row.channelId, row.id)) ||
        (post !== undefined &&
          saved.has(messageUrl(guildId, post.logChannelId, post.logMessageId)))
      );
    };
    for (const row of messages) {
      if (alreadySaved(row)) {
        counts.set(
          row.channelId,
          Math.max(0, (counts.get(row.channelId) ?? 0) - 1),
        );
      }
    }
    const visibleMessages = messages.filter(
      (m) => !loggedOutOfView(m.id) && !alreadySaved(m),
    );
    // A deleted alert is only visible through its log post, same as messages.
    const visibleAlerts = alertRows.filter(
      (a) => !loggedOutOfView(a.id) && !alreadySaved(a),
    );

    const suggestions = [
      ...this.automodSuggestions(visibleAlerts, access, allowed),
      ...this.messageSuggestions(visibleMessages, posts, counts),
    ];

    return suggestions
      .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
      .slice(0, MAX_SUGGESTIONS);
  }

  /**
   * Whether the target has anything that could become a suggestion, for any
   * viewer. DB-only; `find` still decides what a given mod sees.
   */
  async hasCandidates(
    input: Omit<FindSuggestionsInput, "viewer">,
  ): Promise<boolean> {
    if (input.savedMessageLinks?.length) {
      return (
        (
          await this.findWithAccess(input, {
            prepare: async () => undefined,
            canView: () => true,
            canRead: () => true,
            channelName: () => null,
          })
        ).length > 0
      );
    }
    const { guildId, targetId, actionTime } = input;
    if (!(await this.messageLogEnabled(guildId))) {
      return false;
    }

    const range = {
      from: new Date(actionTime.getTime() - SUGGESTION_WINDOW_MS),
      to: actionTime,
    };
    const [blocks, counts, alerts] = await Promise.all([
      this.deps.logBlocks.findByGuildId(guildId),
      this.deps.messages.countTargetMessagesByChannel(
        guildId,
        targetId,
        range,
        [],
      ),
      this.deps.messages.findTargetAutomodAlerts(
        guildId,
        targetId,
        range,
        AUTOMOD_CANDIDATES,
      ),
    ]);
    const blocked = new Set(blocks.map((b) => b.channelId));

    return (
      [...counts.keys()].some((id) => !blocked.has(id)) ||
      alerts.some((a) => !blocked.has(a.channelId))
    );
  }

  async resolveLinks(
    suggestion: ProofSuggestion,
    options: ResolveLinksOptions,
  ): Promise<ResolvedSuggestionLinks> {
    const [resolved] = await this.resolveLinksMany([suggestion], options);
    return resolved;
  }

  /** Index-aligned with `suggestions`; shares one purge wait and one existence check per channel. */
  async resolveLinksMany(
    suggestions: ProofSuggestion[],
    options: ResolveLinksOptions,
  ): Promise<ResolvedSuggestionLinks[]> {
    const { guildId } = options;
    const posts = await this.postsById(
      guildId,
      unique(suggestions.flatMap((s) => s.messageIds)),
    );

    const inPurge = purgeMatcher(options, this.now());
    // Alerts sit in the alert channel, which a ban doesn't purge.
    const purgeable = (s: ProofSuggestion) => s.kind !== "automod";

    let waiting = unique(
      suggestions.filter(purgeable).flatMap((s) => s.messageIds),
    ).filter((id) => inPurge(id) && !posts.has(id));
    const deadline = this.now() + PURGE_WAIT_MS;
    while (waiting.length > 0 && this.now() < deadline) {
      await this.sleep(PURGE_POLL_MS);
      await this.mergePosts(guildId, waiting, posts);
      waiting = waiting.filter((id) => !posts.has(id));
    }

    const unmappedByChannel = new Map<string, Set<string>>();
    for (const s of suggestions) {
      for (const id of s.messageIds) {
        if (!posts.has(id)) {
          const group = unmappedByChannel.get(s.channelId) ?? new Set();
          group.add(id);
          unmappedByChannel.set(s.channelId, group);
        }
      }
    }

    const existence = new Map<string, MessageExistence>();
    await Promise.all(
      [...unmappedByChannel].map(async ([channelId, ids]) => {
        const states = await this.deps.existence.checkMany(channelId, [...ids]);
        for (const [id, state] of states) {
          existence.set(id, state);
        }
      }),
    );

    // The log post may land while the existence checks run.
    const gone = [...existence]
      .filter(([, state]) => state === "unknown_message")
      .map(([id]) => id);
    if (gone.length > 0) {
      await this.mergePosts(guildId, gone, posts);
    }

    return suggestions.map((s) =>
      this.linksFor(
        s,
        guildId,
        posts,
        existence,
        (id) => purgeable(s) && inPurge(id),
      ),
    );
  }

  private linksFor(
    suggestion: ProofSuggestion,
    guildId: string,
    posts: Map<string, MessageLogPost>,
    existence: Map<string, MessageExistence>,
    purged: (messageId: string) => boolean,
  ): ResolvedSuggestionLinks {
    const ids = suggestion.messageIds;
    const pending: string[] = [];
    const skipped: SkippedMessage[] = [];
    const links: ResolvedLink[] = [];
    const logLinks = new Map<string, ResolvedLink>();

    for (const id of ids) {
      const post = posts.get(id);
      if (post) {
        const existing = logLinks.get(post.logMessageId);
        if (existing) {
          existing.messageIds.push(id);
          continue;
        }

        const link: ResolvedLink = {
          url: messageUrl(guildId, post.logChannelId, post.logMessageId),
          source: "log",
          channelId: post.logChannelId,
          messageIds: [id],
        };
        logLinks.set(post.logMessageId, link);
        links.push(link);
        continue;
      }

      const state = existence.get(id);
      if (state === "exists") {
        links.push({
          url: messageUrl(guildId, suggestion.channelId, id),
          source: "message",
          channelId: suggestion.channelId,
          messageIds: [id],
        });
      } else if (state === "unknown_message" && purged(id)) {
        pending.push(id);
      } else if (state === "unknown_message") {
        skipped.push({ messageId: id, reason: "deleted_not_logged" });
      } else {
        skipped.push({ messageId: id, reason: "unchecked" });
      }
    }

    return { links, pending, skipped };
  }

  /** Null when the viewer can no longer see the suggestion. */
  async toPreviewRequest(
    suggestion: ProofSuggestion,
    context: PreviewContext,
  ): Promise<PreviewRequest | null> {
    return this.toPreviewRequestWithAccess(
      suggestion,
      context,
      viewerAccessFromMember(context.viewer, this.deps.logger),
    );
  }

  async toPreviewRequestWithAccess(
    suggestion: ProofSuggestion,
    context: Omit<PreviewContext, "viewer">,
    access: ViewerAccess,
  ): Promise<PreviewRequest | null> {
    const { guildId, targetId } = context;

    await access.prepare(
      suggestion.blockedInChannelId
        ? [suggestion.channelId, suggestion.blockedInChannelId]
        : [suggestion.channelId],
    );
    const channelVisible =
      suggestion.kind === "automod"
        ? access.canView(suggestion.channelId)
        : access.canRead(suggestion.channelId);
    if (
      !channelVisible ||
      (await this.deps.logBlocks.findByGuildAndChannel(
        guildId,
        suggestion.channelId,
      ))
    ) {
      return null;
    }

    // Callers pass suggestions back from component state, so only the target's rows in its channel count.
    const byTarget = (row: CachedMessage) =>
      suggestion.kind === "automod"
        ? row.authorId === targetId &&
          row.msg.type === AUTOMOD_ALERT_MESSAGE_TYPE
        : row.authorId === targetId || row.interactionUserId === targetId;
    const targetRows = (
      await this.deps.messages.findByIds(guildId, suggestion.messageIds)
    )
      .filter((row) => row.channelId === suggestion.channelId && byTarget(row))
      .sort(byCreatedAsc);

    const targetPosts = await this.postsById(
      guildId,
      targetRows.map((r) => r.id),
    );
    const logChannels = unique(
      [...targetPosts.values()].map((p) => p.logChannelId),
    );
    await access.prepare(logChannels);
    if (logChannels.some((id) => !access.canView(id))) {
      return null;
    }

    const names = new Map<string, string>();
    const remember = (row: CachedMessage) => {
      if (!row.msg.author.bot) {
        names.set(row.authorId, displayName(row.msg));
      }
    };
    targetRows.forEach(remember);
    if (context.targetDisplayName) {
      names.set(targetId, context.targetDisplayName);
    }
    const targetName = names.get(targetId) ?? "this user";

    if (suggestion.kind === "automod") {
      return this.automodPreview(
        suggestion,
        targetRows,
        names,
        context,
        access,
      );
    }

    const contextRows = await this.contextRows(
      guildId,
      suggestion,
      targetId,
      targetRows,
      access,
    );
    contextRows.forEach(remember);

    const posts = await this.postsById(guildId, [
      ...targetRows.map((r) => r.id),
      ...contextRows.map((r) => r.id),
    ]);

    const messages = [...targetRows, ...contextRows]
      .sort(byCreatedAsc)
      .map((row) => toPreviewMessage(row, names, posts.has(row.id), false));

    const shown = targetRows.length;
    const range =
      shown > 0
        ? clockRange(targetRows[0].createdAt, targetRows[shown - 1].createdAt)
        : clockRange(suggestion.firstAt, suggestion.lastAt);
    const counts =
      suggestion.totalInWindow > shown
        ? `last ${shown} of ${suggestion.totalInWindow} from ${targetName}`
        : `${plural(shown, "message")} from ${targetName}`;

    return {
      guildId,
      channelName: access.channelName(suggestion.channelId) ?? "unknown",
      subtitle: `${range} · ${counts}`,
      targetUserId: targetId,
      messages,
      hiddenEarlierCount: Math.max(0, suggestion.totalInWindow - shown),
    };
  }

  private automodPreview(
    suggestion: ProofSuggestion,
    rows: CachedMessage[],
    names: Map<string, string>,
    context: Omit<PreviewContext, "viewer">,
    access: ViewerAccess,
  ): PreviewRequest {
    const messages = rows.map((row) => {
      const message = toPreviewMessage(row, names, false, true);
      const alert = parseAutomodAlert(row.msg.embeds);
      return alert ? { ...message, content: alert.content } : message;
    });

    const blockedIn = suggestion.blockedInChannelId;
    const blockedInName =
      blockedIn && access.canView(blockedIn)
        ? access.channelName(blockedIn)
        : null;

    return {
      guildId: context.guildId,
      channelName:
        blockedInName || access.channelName(suggestion.channelId) || "unknown",
      subtitle: `${formatClock(suggestion.lastAt)} · AutoMod: ${suggestion.ruleName ?? "alert"}`,
      targetUserId: context.targetId,
      messages,
      hiddenEarlierCount: 0,
    };
  }

  /** Up to two messages from others before each target message, from the same channel. */
  private async contextRows(
    guildId: string,
    suggestion: ProofSuggestion,
    targetId: string,
    targetRows: CachedMessage[],
    access: ViewerAccess,
  ): Promise<CachedMessage[]> {
    if (targetRows.length === 0) {
      return [];
    }

    const first = targetRows[0].createdAt;
    const last = targetRows[targetRows.length - 1].createdAt;
    const others = await this.deps.messages.findOthersInChannel(
      guildId,
      suggestion.channelId,
      targetId,
      { from: new Date(first.getTime() - CONTEXT_LOOKBACK_MS), to: last },
      CONTEXT_ROW_LIMIT,
    );

    const posts = await this.postsById(
      guildId,
      others.map((o) => o.id),
    );
    await access.prepare([...posts.values()].map((p) => p.logChannelId));
    const visible = others
      .filter((o) => {
        const post = posts.get(o.id);
        return !post || access.canView(post.logChannelId);
      })
      .sort(byCreatedAsc);

    const picked: CachedMessage[] = [];
    let previous = Number.NEGATIVE_INFINITY;
    for (const target of targetRows) {
      const at = target.createdAt.getTime();
      const gap = visible.filter((o) => {
        const t = o.createdAt.getTime();
        return t > previous && t <= at;
      });
      picked.push(...gap.slice(-CONTEXT_PER_GAP));
      previous = at;
    }

    return picked;
  }

  private automodSuggestions(
    rows: CachedMessage[],
    access: ViewerAccess,
    allowed: (channelId: string) => boolean,
  ): ProofSuggestion[] {
    const suggestions: ProofSuggestion[] = [];

    for (const row of rows) {
      if (suggestions.length >= MAX_AUTOMOD_SUGGESTIONS) {
        break;
      }

      if (!allowed(row.channelId) || !access.canView(row.channelId)) {
        continue;
      }

      const alert = parseAutomodAlert(row.msg.embeds);
      if (!alert) {
        if (!this.loggedUnparsedAlert) {
          this.loggedUnparsedAlert = true;
          this.deps.logger.debug(
            { messageId: row.id, embeds: row.msg.embeds },
            "Skipping AutoMod alert with unexpected embed shape",
          );
        }
        continue;
      }

      suggestions.push({
        kind: "automod",
        channelId: row.channelId,
        blockedInChannelId: alert.blockedInChannelId,
        messageIds: [row.id],
        totalInWindow: 1,
        firstAt: row.createdAt,
        lastAt: row.createdAt,
        snippet: toSnippet(alert.content),
        ruleName: alert.ruleName,
      });
    }

    return suggestions;
  }

  private messageSuggestions(
    messages: CachedMessage[],
    posts: Map<string, MessageLogPost>,
    counts: Map<string, number>,
  ): ProofSuggestion[] {
    const byChannel = new Map<string, CachedMessage[]>();
    for (const message of messages) {
      const group = byChannel.get(message.channelId) ?? [];
      group.push(message);
      byChannel.set(message.channelId, group);
    }

    return [...byChannel.entries()].map(([channelId, group]) => {
      const ordered = [...group].sort(byCreatedAsc);
      const deletedCount = ordered.filter((m) => posts.has(m.id)).length;
      const newest = ordered[ordered.length - 1];

      return {
        kind: deletedCount === ordered.length ? "deleted" : "recent",
        channelId,
        messageIds: ordered.map((m) => m.id),
        totalInWindow: Math.max(counts.get(channelId) ?? 0, ordered.length),
        firstAt: ordered[0].createdAt,
        lastAt: newest.createdAt,
        snippet: snippetFor(ordered),
        deletedCount,
      };
    });
  }

  private async messageLogEnabled(guildId: string): Promise<boolean> {
    const { loggingSettings } =
      await this.deps.guildConfigs.findByGuildId(guildId);
    return (
      !!loggingSettings.messageLogChannel && loggingSettings.messageLogEnabled
    );
  }

  private async mergePosts(
    guildId: string,
    messageIds: string[],
    posts: Map<string, MessageLogPost>,
  ): Promise<void> {
    for (const [id, post] of await this.postsById(guildId, messageIds)) {
      posts.set(id, post);
    }
  }

  private async postsById(
    guildId: string,
    messageIds: string[],
  ): Promise<Map<string, MessageLogPost>> {
    const posts = await this.deps.logPosts.findByMessageIds(
      guildId,
      messageIds,
    );
    return new Map(posts.map((p) => [p.messageId, p]));
  }
}

/** Whether a message's delete may still be on its way to the message log because the action purged it. */
function purgeMatcher(
  options: ResolveLinksOptions,
  now: number,
): (messageId: string) => boolean {
  const actionMs = options.actionTime.getTime();
  const fresh =
    PURGE_ACTIONS.has(options.actionKind) && now - actionMs < FRESH_PURGE_MS;
  if (!fresh) {
    return () => false;
  }

  if (options.purgeWindowUnknown) {
    return () => true;
  }

  const windowMs = (options.purgeWindowSeconds ?? 0) * 1000;
  if (windowMs <= 0) {
    return () => false;
  }

  return (messageId) => {
    const createdMs = SnowflakeUtil.timestampFrom(messageId);
    return createdMs >= actionMs - windowMs && createdMs <= actionMs;
  };
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function byCreatedAsc(a: CachedMessage, b: CachedMessage): number {
  return (
    a.createdAt.getTime() - b.createdAt.getTime() || compareIds(a.id, b.id)
  );
}

function compareIds(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function clockRange(first: Date, last: Date): string {
  const a = formatClock(first);
  const b = formatClock(last);
  return a === b ? a : `${a} – ${b}`;
}

function snippetFor(ordered: CachedMessage[]): string {
  for (let i = ordered.length - 1; i >= 0; i--) {
    const msg = ordered[i];
    const text = toSnippet(msg.content);
    if (text) {
      return text;
    }

    const file = msg.msg.attachments?.[0]?.filename;
    if (file) {
      return toSnippet(`[${file}]`);
    }
  }

  return "";
}

function toPreviewMessage(
  row: CachedMessage,
  names: Map<string, string>,
  deleted: boolean,
  automodFlagged: boolean,
): PreviewMessage {
  const author: PreviewAuthor = {
    id: row.authorId,
    displayName: displayName(row.msg),
    memberAvatarHash: row.msg.member?.avatar ?? null,
    userAvatarHash: row.msg.author.avatar,
    discriminator: row.msg.author.discriminator,
    isApp: row.msg.author.bot,
  };

  const message: PreviewMessage = {
    id: row.id,
    author,
    createdAt: row.createdAt,
    content: row.content,
    attachmentNames: (row.msg.attachments ?? []).map((a) => a.filename),
    deleted,
    automodFlagged,
  };

  if (row.interactionUserId) {
    message.triggeredById = row.interactionUserId;
    const name = names.get(row.interactionUserId);
    if (name) {
      message.triggeredBy = name;
    }
  }

  return message;
}
