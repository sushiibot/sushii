import type {
  AutocompleteFocusedOption,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
} from "discord.js";
import {
  ApplicationIntegrationType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import { modLogEntryUrl } from "@/features/moderation/actions/presentation/response/modLogEntryUrl";
import type {
  AddProofError,
  CaseProofService,
  ProofFileSource,
} from "@/features/moderation/cases/application/CaseProofService";
import { proofFileMaxBytes } from "@/features/moderation/shared/application/proofDownloads";
import {
  PROOF_CONTENT_MAX_LENGTH,
  PROOF_FILES_PER_CASE_MAX,
} from "@/features/moderation/shared/domain/entities/CaseProof";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import type { CaseProofRepository } from "@/features/moderation/shared/domain/repositories/CaseProofRepository";
import type { ModLogRepository } from "@/features/moderation/shared/domain/repositories/ModLogRepository";
import {
  NO_MOD_LOG_FOR_FILES_TEXT,
  proofErrorText,
  proofNotice,
  typedBackText,
} from "@/features/moderation/shared/presentation/proof/proofMessages";
import { getErrorMessage } from "@/interactions/responses/error";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";
import {
  AutocompleteHandler,
  SlashCommandHandler,
} from "@/shared/presentation/handlers";

import {
  PROOF_COMMAND_EMOJIS,
  PROOF_EMPTY_HINT,
  buildProofAddedMessage,
  formatProofCaseChoice,
} from "../views/ProofCommandView";

const FILE_OPTIONS = ["file", "file_2", "file_3"] as const;
const AUTOCOMPLETE_LIMIT = 25;

export interface ProofCommandDeps {
  modLogRepository: Pick<ModLogRepository, "findByIds">;
  caseProofRepository: Pick<CaseProofRepository, "countsByCases">;
  guildConfigRepository: Pick<GuildConfigRepository, "findByGuildId">;
  caseProofService: Pick<CaseProofService, "add">;
  emojiRepository: Pick<BotEmojiRepository, "getEmojis">;
  logger: Logger;
}

/** "#4822", "4822 " → "4822"; null for anything else, e.g. a range. */
export function parseProofCaseOption(value: string): string | null {
  const caseId = value.trim().replace(/^#/, "");
  return /^\d{1,18}$/.test(caseId) ? caseId : null;
}

export class ProofCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("proof")
    .setDescription("Add proof to a case. Only mods see it.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName("case")
        .setDescription("Case number or user")
        .setAutocomplete(true)
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("text")
        .setDescription(
          "Context, message links, anything other mods should know",
        )
        .setMaxLength(PROOF_CONTENT_MAX_LENGTH)
        .setRequired(false),
    )
    .addAttachmentOption((o) =>
      o
        .setName("file")
        .setDescription("Screenshot or recording")
        .setRequired(false),
    )
    .addAttachmentOption((o) =>
      o.setName("file_2").setDescription("Another file").setRequired(false),
    )
    .addAttachmentOption((o) =>
      o.setName("file_3").setDescription("Another file").setRequired(false),
    )
    .toJSON();

  constructor(private readonly deps: ProofCommandDeps) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild not cached");
    }

    const typedCase = interaction.options.getString("case", true);
    const content = interaction.options.getString("text")?.trim() || null;
    const attachments = FILE_OPTIONS.flatMap(
      (name) => interaction.options.getAttachment(name) ?? [],
    );
    const files: ProofFileSource[] = attachments.map((a) => ({
      url: a.url,
      name: a.name,
      size: a.size,
      contentType: a.contentType,
    }));
    const maxFileBytes = proofFileMaxBytes(interaction.attachmentSizeLimit);

    const checked = await this.check(interaction, typedCase, content, files);
    if ("refusal" in checked) {
      await interaction.reply(proofNotice(checked.refusal));
      return;
    }

    // defer: downloads and re-uploads files
    await interaction.deferReply();

    let result: Awaited<
      ReturnType<ProofCommandDeps["caseProofService"]["add"]>
    >;
    try {
      result = await this.deps.caseProofService.add({
        guildId: interaction.guildId,
        caseIds: [checked.caseId],
        authorId: interaction.user.id,
        kind: "command",
        content,
        files,
        uploadLimit: interaction.attachmentSizeLimit,
      });
    } catch (err) {
      // Logged here instead of the router: its error would land in the public reply.
      this.deps.logger.error(
        { err, guildId: interaction.guildId, caseId: checked.caseId },
        "Failed to add proof",
      );
      await this.replacePrivately(
        interaction,
        getErrorMessage(
          "Couldn't add proof",
          `Something went wrong. Try again.${typedBackText(content)}`,
          true,
        ),
      );
      return;
    }

    if (result.err) {
      await this.replacePrivately(
        interaction,
        proofNotice(this.errorText(result.val, content, maxFileBytes)),
      );
      return;
    }

    const [proof] = result.val.proofs;
    const [moderationCase] = result.val.cases;
    const [config, emojis] = await Promise.all([
      this.deps.guildConfigRepository.findByGuildId(interaction.guildId),
      this.deps.emojiRepository.getEmojis(PROOF_COMMAND_EMOJIS),
    ]);

    await interaction.editReply(
      buildProofAddedMessage({
        moderationCase,
        proof,
        emojis,
        modLogUrl: modLogEntryUrl(
          interaction.guildId,
          config.loggingSettings.modLogChannel,
          moderationCase.msgId ?? proof.hostMessageId,
        ),
      }),
    );
  }

  /**
   * Refusals a mod can predict, sent privately before the public defer.
   * The service checks again; this only keeps them out of the channel.
   */
  private async check(
    interaction: ChatInputCommandInteraction<"cached">,
    typedCase: string,
    content: string | null,
    files: ProofFileSource[],
  ): Promise<{ caseId: string } | { refusal: string }> {
    const maxFileBytes = proofFileMaxBytes(interaction.attachmentSizeLimit);
    const caseId = parseProofCaseOption(typedCase);
    if (!caseId) {
      return {
        refusal: `Pick a case from the list, or type its number.${typedBackText(content)}`,
      };
    }
    if (!content && files.length === 0) {
      return { refusal: this.errorText("empty", content, maxFileBytes) };
    }
    if (content && content.length > PROOF_CONTENT_MAX_LENGTH) {
      return {
        refusal: this.errorText("content_too_long", content, maxFileBytes),
      };
    }
    if (files.some((f) => f.size > maxFileBytes)) {
      return {
        refusal: this.errorText("file_too_large", content, maxFileBytes),
      };
    }

    const [moderationCase] = await this.deps.modLogRepository.findByIds(
      interaction.guildId,
      [caseId],
    );
    if (!moderationCase) {
      return {
        refusal: `There's no case #${caseId} in this server.${typedBackText(content)}`,
      };
    }
    if (files.length === 0) {
      return { caseId };
    }

    const [counts, config] = await Promise.all([
      this.deps.caseProofRepository.countsByCases(interaction.guildId, [
        caseId,
      ]),
      this.deps.guildConfigRepository.findByGuildId(interaction.guildId),
    ]);
    const existing = counts.get(caseId)?.files ?? 0;
    if (existing + files.length > PROOF_FILES_PER_CASE_MAX) {
      return {
        refusal: this.errorText("too_many_files", content, maxFileBytes),
      };
    }
    if (!config.loggingSettings.modLogChannel) {
      return { refusal: NO_MOD_LOG_FOR_FILES_TEXT + typedBackText(content) };
    }
    return { caseId };
  }

  private errorText(
    error: AddProofError,
    content: string | null,
    maxFileBytes: number,
  ): string {
    return proofErrorText(error, {
      emptyHint: PROOF_EMPTY_HINT,
      typed: content,
      maxFileBytes,
    });
  }

  /**
   * The first follow-up after a deferred reply edits it and stays public,
   * so the deferred reply is deleted first. Both are best effort.
   */
  private async replacePrivately(
    interaction: ChatInputCommandInteraction<"cached">,
    message: Parameters<ChatInputCommandInteraction["followUp"]>[0],
  ): Promise<void> {
    await interaction.deleteReply().catch((err: unknown) => {
      this.deps.logger.warn(
        { err, guildId: interaction.guildId },
        "Failed to delete the /proof reply before an error",
      );
    });
    await interaction.followUp(message).catch((err: unknown) => {
      this.deps.logger.warn(
        { err, guildId: interaction.guildId },
        "Failed to send a /proof error",
      );
    });
  }
}

export interface ProofCaseAutocompleteDeps {
  modLogRepository: Pick<ModLogRepository, "searchCases" | "findRecent">;
  logger: Logger;
  now?: () => Date;
}

/** /proof `case`: by case number or username; empty shows the mod's own newest cases. */
export class ProofCaseAutocomplete extends AutocompleteHandler {
  fullCommandNamePath = "proof";

  constructor(private readonly deps: ProofCaseAutocompleteDeps) {
    super();
  }

  protected async handleAutocomplete(
    interaction: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Must be in guild.");
    }
    if (option.name !== "case" || !this.validateStringOption(option)) {
      await interaction.respond([]);
      return;
    }

    const cases = await this.findCases(
      interaction.guildId,
      interaction.user.id,
      option.value,
    );
    const now = this.deps.now?.() ?? new Date();
    await interaction.respond(
      cases.slice(0, AUTOCOMPLETE_LIMIT).map((c) => ({
        name: formatProofCaseChoice(c, now),
        value: c.caseId,
      })),
    );
  }

  private async findCases(
    guildId: string,
    userId: string,
    typed: string,
  ): Promise<ModerationCase[]> {
    const text = typed.trim().replace(/^#/, "");
    if (text) {
      return this.deps.modLogRepository.searchCases(
        guildId,
        { kind: "text", text },
        AUTOCOMPLETE_LIMIT,
      );
    }

    const own = await this.deps.modLogRepository.searchCases(
      guildId,
      { kind: "executor", executorId: userId },
      AUTOCOMPLETE_LIMIT,
    );
    // A mod without recent cases of their own still gets something to pick.
    return own.length > 0
      ? own
      : this.deps.modLogRepository.findRecent(guildId, AUTOCOMPLETE_LIMIT);
  }
}
