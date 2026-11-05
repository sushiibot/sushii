import type {
  AnySelectMenuInteraction,
  ButtonInteraction,
  InteractionEditReplyOptions,
  Message,
  MessageComponentInteraction,
  UserSelectMenuInteraction,
} from "discord.js";
import {
  DiscordAPIError,
  MessageFlags,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
} from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import type {
  AddProofError,
  CaseProofService,
  ProofFileSource,
} from "@/features/moderation/cases/application/CaseProofService";
import { proofFileMaxBytes } from "@/features/moderation/shared/application/proofDownloads";
import { PROOF_FILES_PER_CASE_MAX } from "@/features/moderation/shared/domain/entities/CaseProof";
import type { ModLogRepository } from "@/features/moderation/shared/domain/repositories/ModLogRepository";
import {
  PROOF_INTRO_ID,
  type PromptOffer,
} from "@/features/moderation/shared/presentation/proof/proofIntroOffer";
import {
  proofErrorText,
  proofNotice,
} from "@/features/moderation/shared/presentation/proof/proofMessages";
import { getErrorMessageEdit } from "@/interactions/responses/error";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";
import {
  ButtonHandler,
  SelectMenuHandler,
} from "@/shared/presentation/handlers";
import {
  ANY_MOD_PERMISSION,
  requireMemberPermission,
} from "@/shared/presentation/requireMemberPermission";

import {
  ADD_AS_PROOF_EMOJIS,
  PICKER_CASE_LIMIT,
  type PickerInput,
  type SourceMessage,
  type SourceMessageRef,
  buildAddAsProofAdding,
  buildAddAsProofDone,
  buildAddAsProofPicker,
  parseAddAsProofCustomId,
  proofSourceContent,
} from "../views/AddAsProofView";

export interface AddAsProofDeps {
  modLogRepository: Pick<ModLogRepository, "findNewestByUser">;
  guildConfigRepository: Pick<GuildConfigRepository, "findByGuildId">;
  caseProofService: Pick<CaseProofService, "add">;
  emojiRepository: Pick<BotEmojiRepository, "getEmojis">;
  promptOffer: PromptOffer;
  logger: Logger;
  now?: () => Date;
}

/** A source message always carries its link, so it's never empty. */
const EMPTY_HINT = "Pick a message with text or files.";

export const SOURCE_MESSAGE_GONE_TEXT =
  "That message was deleted, or sushii can't read its channel, so it can't be added as proof.";

type MessageLike = Pick<Message, "content" | "attachments">;

/** A forward's own content is empty; what was forwarded is in its snapshot. */
function forwardedSnapshot(message: Message): MessageLike | null {
  return message.messageSnapshots?.first() ?? null;
}

function contentOf(message: Message): MessageLike {
  return forwardedSnapshot(message) ?? message;
}

export function toSourceMessage(message: Message): SourceMessage {
  const shown = contentOf(message);
  return {
    id: message.id,
    channelId: message.channelId,
    url: message.url,
    authorId: message.author.id,
    content: shown.content ?? "",
    files: shown.attachments.map((a) => ({ contentType: a.contentType })),
    forwarded: forwardedSnapshot(message) !== null,
  };
}

function proofFiles(message: Message): ProofFileSource[] {
  return contentOf(message).attachments.map((a) => ({
    url: a.url,
    name: a.name,
    size: a.size,
    contentType: a.contentType,
  }));
}

const GONE_CODES = new Set<number | string>([
  RESTJSONErrorCodes.UnknownMessage,
  RESTJSONErrorCodes.UnknownChannel,
  RESTJSONErrorCodes.MissingAccess,
  RESTJSONErrorCodes.MissingPermissions,
]);

const READ_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
];

/**
 * The picker's message, refetched from the ids in its custom id. null when
 * it's gone, or when the bot or the clicker can't read its channel.
 */
export async function fetchSourceMessage(
  interaction: MessageComponentInteraction<"cached">,
  ref: SourceMessageRef,
): Promise<Message | null> {
  try {
    const channel = await interaction.client.channels.fetch(ref.channelId);
    if (
      !channel ||
      channel.isDMBased() ||
      channel.guildId !== interaction.guildId ||
      !channel.isTextBased() ||
      // Threads can return null here at runtime.
      channel.permissionsFor(interaction.member)?.has(READ_PERMISSIONS) !== true
    ) {
      return null;
    }
    return await channel.messages.fetch(ref.messageId);
  } catch (err) {
    if (err instanceof DiscordAPIError && GONE_CODES.has(err.code)) {
      return null;
    }
    throw err;
  }
}

/**
 * The picker for one user's cases. The caller picks the mode: a forward
 * opens as `unknown`, since its author is only whoever forwarded it.
 */
export async function renderAddAsProofPicker(
  deps: AddAsProofDeps,
  guildId: string,
  message: SourceMessage,
  user: { id: string; username: string },
  showing: PickerInput["showing"],
) {
  const [cases, emojis] = await Promise.all([
    showing === "unknown"
      ? []
      : deps.modLogRepository.findNewestByUser(
          guildId,
          user.id,
          PICKER_CASE_LIMIT,
        ),
    deps.emojiRepository.getEmojis(ADD_AS_PROOF_EMOJIS),
  ]);

  return buildAddAsProofPicker({
    message,
    user,
    showing,
    cases,
    emojis,
    now: deps.now?.(),
  });
}

const MB = 1024 * 1024;

/** Why the files can't be stored while the link and text still can; null for other errors. */
export async function filesNotSavedReason(
  error: AddProofError,
  maxFileBytes: number,
  hasModLogChannel: () => Promise<boolean>,
): Promise<string | null> {
  if (error === "file_too_large") {
    return `one is over the ${Math.floor(maxFileBytes / MB)} MB limit.`;
  }
  if (error === "too_many_files") {
    return `a case holds up to ${PROOF_FILES_PER_CASE_MAX} proof files.`;
  }
  if (
    typeof error !== "string" &&
    error.skipped.length > 0 &&
    error.skipped.every((s) => s.reason === "no_mod_log_for_files")
  ) {
    // Also a deleted entry or an old case without one, not only a missing channel.
    const noEntry = "this case has no mod log entry to keep them on.";
    return (await hasModLogChannel())
      ? noEntry
      : `${noEntry} Set a mod log channel in \`/settings\`.`;
  }
  return null;
}

type AddResult = Awaited<ReturnType<AddAsProofDeps["caseProofService"]["add"]>>;

/** Edits the picker, which this flow already acknowledged with an update. */
async function showResult(
  interaction: MessageComponentInteraction<"cached">,
  deps: AddAsProofDeps,
  message: Parameters<MessageComponentInteraction["editReply"]>[0],
): Promise<void> {
  try {
    await interaction.editReply(message);
  } catch (err) {
    deps.logger.warn(
      { err, guildId: interaction.guildId },
      "Failed to show the Add as proof result",
    );
  }
}

const TRY_AGAIN_LINE = "-# Right-click the message to try again.";

function errorEdit(
  text: string,
  { retry }: { retry: boolean },
): InteractionEditReplyOptions {
  const { components, allowedMentions } = proofNotice(
    retry ? `${text}\n${TRY_AGAIN_LINE}` : text,
  );
  // An edit can't set Ephemeral; the picker keeps its own flags.
  return { components, allowedMentions, flags: MessageFlags.IsComponentsV2 };
}

/**
 * Adds the picker's message to a case. The picker is first replaced with an
 * "Adding…" state, so a second click can't add it again.
 */
async function addMessageToCase(
  interaction: ButtonInteraction<"cached"> | AnySelectMenuInteraction<"cached">,
  deps: AddAsProofDeps,
  ref: SourceMessageRef,
  caseId: string,
): Promise<void> {
  await interaction.update(buildAddAsProofAdding(caseId));

  const message = await fetchSourceMessage(interaction, ref);
  if (!message) {
    // Retrying can't help: the message is gone or unreadable.
    await showResult(
      interaction,
      deps,
      errorEdit(SOURCE_MESSAGE_GONE_TEXT, { retry: false }),
    );
    return;
  }

  const maxFileBytes = proofFileMaxBytes(interaction.attachmentSizeLimit);
  const forwarded = forwardedSnapshot(message) !== null;
  const add = (files: ProofFileSource[], fallback = false) =>
    deps.caseProofService.add({
      guildId: interaction.guildId,
      caseIds: [caseId],
      authorId: interaction.user.id,
      kind: "context_menu",
      content: null,
      files,
      // A forward's author is only whoever forwarded it, so it's named in the text instead.
      source: {
        url: message.url,
        authorId: forwarded ? null : message.author.id,
        content: proofSourceContent(contentOf(message).content ?? "", {
          forwardedBy: forwarded ? message.author.id : undefined,
        }),
      },
      uploadLimit: interaction.attachmentSizeLimit,
      fallback,
    });

  let result: AddResult;
  let filesNotSaved: string | undefined;
  try {
    result = await add(proofFiles(message));
    const reason = result.err
      ? await filesNotSavedReason(result.val, maxFileBytes, async () => {
          const config = await deps.guildConfigRepository.findByGuildId(
            interaction.guildId,
          );
          return config.loggingSettings.modLogChannel !== null;
        })
      : null;
    if (reason) {
      // The link and text still count as proof without the files.
      filesNotSaved = reason;
      result = await add([], true);
    }
  } catch (err) {
    // Logged here instead of the router, which would answer a second time.
    deps.logger.error(
      { err, guildId: interaction.guildId, caseId, messageId: ref.messageId },
      "Failed to add a message as proof",
    );
    await showResult(
      interaction,
      deps,
      getErrorMessageEdit(
        "Couldn't add proof",
        "Something went wrong. Right-click the message to try again.",
      ),
    );
    return;
  }

  if (result.err) {
    await showResult(
      interaction,
      deps,
      errorEdit(
        proofErrorText(result.val, { emptyHint: EMPTY_HINT, maxFileBytes }),
        { retry: true },
      ),
    );
    return;
  }

  const [proof] = result.val.proofs;
  const [moderationCase] = result.val.cases;
  const emojis = await deps.emojiRepository.getEmojis(ADD_AS_PROOF_EMOJIS);
  await showResult(
    interaction,
    deps,
    buildAddAsProofDone({
      moderationCase,
      proof,
      files: toSourceMessage(message).files,
      emojis,
      filesNotSaved,
    }),
  );
  await deps.promptOffer.offer(interaction, PROOF_INTRO_ID);
}

async function hasModPermission(
  interaction: MessageComponentInteraction<"cached">,
): Promise<boolean> {
  return requireMemberPermission(
    interaction,
    ANY_MOD_PERMISSION.flags,
    ANY_MOD_PERMISSION.name,
  );
}

/** "Add to #N": the newest case on the picker. */
export class AddAsProofButtonHandler extends ButtonHandler {
  customIDMatch = (customId: string) =>
    parseAddAsProofCustomId(customId)?.kind === "add"
      ? { path: customId, index: 0, params: {} }
      : false;

  constructor(private readonly deps: AddAsProofDeps) {
    super();
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    const id = parseAddAsProofCustomId(interaction.customId);
    if (id?.kind !== "add") {
      throw new Error("No add as proof match", {
        cause: { customId: interaction.customId },
      });
    }

    if (!(await hasModPermission(interaction))) {
      return;
    }

    await addMessageToCase(interaction, this.deps, id, id.caseId);
  }
}

/** The picker's case select and its "Someone else's case…" user select. */
export class AddAsProofSelectHandler extends SelectMenuHandler {
  customIDMatch = (customId: string) => {
    const kind = parseAddAsProofCustomId(customId)?.kind;
    return kind === "pick" || kind === "user"
      ? { path: customId, index: 0, params: {} }
      : false;
  };

  constructor(private readonly deps: AddAsProofDeps) {
    super();
  }

  async handleInteraction(
    interaction: AnySelectMenuInteraction,
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    const id = parseAddAsProofCustomId(interaction.customId);
    if (id?.kind !== "pick" && id?.kind !== "user") {
      throw new Error("No add as proof select match", {
        cause: { customId: interaction.customId },
      });
    }

    if (!(await hasModPermission(interaction))) {
      return;
    }

    if (id.kind === "pick") {
      const [caseId] = interaction.values;
      if (!caseId) {
        throw new Error("Add as proof select without a case");
      }
      await addMessageToCase(interaction, this.deps, id, caseId);
      return;
    }

    if (!interaction.isUserSelectMenu()) {
      throw new Error("Add as proof user select isn't a user select");
    }
    await this.showUser(interaction, id);
  }

  private async showUser(
    interaction: UserSelectMenuInteraction<"cached">,
    ref: SourceMessageRef,
  ): Promise<void> {
    const message = await fetchSourceMessage(interaction, ref);
    if (!message) {
      await interaction.reply(proofNotice(SOURCE_MESSAGE_GONE_TEXT));
      return;
    }

    const user = interaction.users.first();
    if (!user) {
      throw new Error("Add as proof user select without a user");
    }
    const source = toSourceMessage(message);
    const picker = await renderAddAsProofPicker(
      this.deps,
      interaction.guildId,
      source,
      { id: user.id, username: user.username },
      user.id === source.authorId && !source.forwarded ? "author" : "other",
    );
    // An update can't set Ephemeral; the picker keeps its own flags.
    await interaction.update({ ...picker, flags: MessageFlags.IsComponentsV2 });
  }
}
