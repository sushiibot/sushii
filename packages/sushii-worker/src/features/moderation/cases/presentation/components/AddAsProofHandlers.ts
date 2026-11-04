import type {
  AnySelectMenuInteraction,
  ButtonInteraction,
  Message,
  MessageComponentInteraction,
  UserSelectMenuInteraction,
} from "discord.js";
import { DiscordAPIError, MessageFlags, RESTJSONErrorCodes } from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import type {
  CaseProofService,
  ProofFileSource,
} from "@/features/moderation/cases/application/CaseProofService";
import { proofFileMaxBytes } from "@/features/moderation/shared/application/proofDownloads";
import type { ModLogRepository } from "@/features/moderation/shared/domain/repositories/ModLogRepository";
import {
  proofErrorText,
  proofNotice,
} from "@/features/moderation/shared/presentation/proof/proofMessages";
import { getErrorMessage } from "@/interactions/responses/error";
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
  type SourceMessage,
  type SourceMessageRef,
  buildAddAsProofDone,
  buildAddAsProofPicker,
  parseAddAsProofCustomId,
  proofSourceContent,
} from "../views/AddAsProofView";

export interface AddAsProofDeps {
  modLogRepository: Pick<ModLogRepository, "findNewestByUser">;
  caseProofService: Pick<CaseProofService, "add">;
  emojiRepository: Pick<BotEmojiRepository, "getEmojis">;
  logger: Logger;
  now?: () => Date;
}

/** A source message always carries its link, so it's never empty. */
const EMPTY_HINT = "Pick a message with text or files.";

export const SOURCE_MESSAGE_GONE_TEXT =
  "That message was deleted or sushii can't read its channel anymore, so it can't be added as proof.";

export function toSourceMessage(message: Message): SourceMessage {
  return {
    id: message.id,
    channelId: message.channelId,
    url: message.url,
    authorId: message.author.id,
    content: message.content,
    files: message.attachments.map((a) => ({ contentType: a.contentType })),
  };
}

function proofFiles(message: Message): ProofFileSource[] {
  return message.attachments.map((a) => ({
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

/** The picker's message, refetched from the ids in its custom id; null when gone or unreadable. */
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
      !channel.isTextBased()
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

/** The picker for one user's cases: the message author first, or anyone picked after. */
export async function renderAddAsProofPicker(
  deps: AddAsProofDeps,
  guildId: string,
  message: SourceMessage,
  user: { id: string; username: string },
) {
  const [cases, emojis] = await Promise.all([
    deps.modLogRepository.findNewestByUser(guildId, user.id, PICKER_CASE_LIMIT),
    deps.emojiRepository.getEmojis(ADD_AS_PROOF_EMOJIS),
  ]);

  return buildAddAsProofPicker({
    message,
    user,
    showing: user.id === message.authorId ? "author" : "other",
    cases,
    emojis,
    now: deps.now?.(),
  });
}

async function noteAfterDefer(
  interaction: MessageComponentInteraction<"cached">,
  deps: AddAsProofDeps,
  message: Parameters<MessageComponentInteraction["followUp"]>[0],
): Promise<void> {
  try {
    await interaction.followUp(message);
  } catch (err) {
    deps.logger.warn(
      { err, guildId: interaction.guildId },
      "Failed to send an Add as proof note",
    );
  }
}

/** Adds the picker's message to a case, then turns the picker into the confirmation. */
async function addMessageToCase(
  interaction: MessageComponentInteraction<"cached">,
  deps: AddAsProofDeps,
  ref: SourceMessageRef,
  caseId: string,
): Promise<void> {
  // defer: downloads and re-uploads the message's images
  await interaction.deferUpdate();

  const message = await fetchSourceMessage(interaction, ref);
  if (!message) {
    await noteAfterDefer(
      interaction,
      deps,
      proofNotice(SOURCE_MESSAGE_GONE_TEXT),
    );
    return;
  }

  const files = proofFiles(message);
  let result: Awaited<ReturnType<AddAsProofDeps["caseProofService"]["add"]>>;
  try {
    result = await deps.caseProofService.add({
      guildId: interaction.guildId,
      caseIds: [caseId],
      authorId: interaction.user.id,
      kind: "context_menu",
      content: null,
      files,
      source: {
        url: message.url,
        authorId: message.author.id,
        content: proofSourceContent(message.content),
      },
      uploadLimit: interaction.attachmentSizeLimit,
    });
  } catch (err) {
    // Logged here instead of the router: its error would replace the picker.
    deps.logger.error(
      { err, guildId: interaction.guildId, caseId, messageId: ref.messageId },
      "Failed to add a message as proof",
    );
    await noteAfterDefer(
      interaction,
      deps,
      getErrorMessage(
        "Couldn't add proof",
        "Something went wrong. Try again.",
        true,
      ),
    );
    return;
  }

  if (result.err) {
    await noteAfterDefer(
      interaction,
      deps,
      proofNotice(
        proofErrorText(result.val, {
          emptyHint: EMPTY_HINT,
          maxFileBytes: proofFileMaxBytes(interaction.attachmentSizeLimit),
        }),
      ),
    );
    return;
  }

  const [proof] = result.val.proofs;
  const [moderationCase] = result.val.cases;
  const emojis = await deps.emojiRepository.getEmojis(ADD_AS_PROOF_EMOJIS);
  await interaction.editReply(
    buildAddAsProofDone({
      moderationCase,
      proof,
      files: toSourceMessage(message).files,
      emojis,
    }),
  );
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

    // Clearing the select goes back to the author's cases.
    const user = interaction.users.first() ?? message.author;
    const picker = await renderAddAsProofPicker(
      this.deps,
      interaction.guildId,
      toSourceMessage(message),
      { id: user.id, username: user.username },
    );
    // An update can't set Ephemeral; the picker keeps its own flags.
    await interaction.update({ ...picker, flags: MessageFlags.IsComponentsV2 });
  }
}
