import type {
  APIMessageTopLevelComponent,
  ButtonInteraction,
} from "discord.js";
import { ComponentType, MessageFlags } from "discord.js";

import {
  type ResponseRefreshDeps,
  rebuildResponseWithProof,
} from "@/features/moderation/cases/presentation/components/AddProofButtonHandler";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { buildAddProofCustomId } from "@/features/moderation/shared/presentation/proof/customIds";
import { ButtonHandler } from "@/shared/presentation/handlers";
import {
  ANY_MOD_PERMISSION,
  requireMemberPermission,
} from "@/shared/presentation/requireMemberPermission";
import Color from "@/utils/colors";

import { viewerAccessFromMember } from "../application/viewerAccess";
import type { ProofSuggestion } from "../domain/ProofSuggestion";
import type { SuggestionFlow } from "./SuggestionFlow";
import {
  type SuggestButton,
  isSuggestButtonId,
  isSuggestUndoId,
  parseSuggestButtonId,
} from "./customIds";
import {
  CASE_GONE_TEXT,
  NOTHING_SELECTED_TEXT,
  OUT_OF_DATE_TEXT,
  SUGGESTIONS_CHANGED_TEXT,
  SUGGESTIONS_DIFFER_TEXT,
  UNDO_ERROR_TEXT,
  UNDO_GONE_TEXT,
  UNDO_NOT_ALLOWED_TEXT,
  UNDO_UNAVAILABLE_TEXT,
  linksFromAddedText,
  preselected,
  undoFailedText,
  undoneText,
} from "./suggestionText";
import {
  type NoticeMessage,
  buildNothingLeft,
  buildPicker,
  buildResponseSuggestionBlock,
  buildSuggestionAddResult,
  buildSuggestionNotice,
  buildUndoResult,
  selectedInPicker,
} from "./views";

export interface ProofSuggestionButtonDeps {
  flow: SuggestionFlow;
  response: ResponseRefreshDeps;
  now?: () => number;
}

function ephemeral(message: NoticeMessage) {
  return {
    ...message,
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  } as const;
}

function postedOf(
  interaction: ButtonInteraction,
): APIMessageTopLevelComponent[] {
  return interaction.message.components.map((c) =>
    c.toJSON(),
  ) as APIMessageTopLevelComponent[];
}

function firstText(
  posted: readonly APIMessageTopLevelComponent[],
): string | null {
  for (const top of posted) {
    if (top.type !== ComponentType.Container) {
      continue;
    }
    for (const child of top.components) {
      if (child.type === ComponentType.TextDisplay) {
        return child.content;
      }
    }
  }
  return null;
}

/** Valid indexes into the suggestions, in order; null if any value is garbled. */
function chosenFrom(
  values: readonly string[],
  suggestions: readonly ProofSuggestion[],
): ProofSuggestion[] | null {
  const indexes = new Set<number>();
  for (const value of values) {
    if (!/^\d{1,2}$/.test(value)) {
      return null;
    }
    const index = Number(value);
    if (index >= suggestions.length) {
      return null;
    }
    indexes.add(index);
  }
  return [...indexes].sort((a, b) => a - b).map((i) => suggestions[i]);
}

/** Review, Add all, Add N and Undo for suggested proof. */
export class ProofSuggestionButtonHandler extends ButtonHandler {
  customIDMatch = (customId: string) =>
    isSuggestButtonId(customId)
      ? { path: customId, index: 0, params: {} }
      : false;

  private readonly now: () => number;

  constructor(private readonly deps: ProofSuggestionButtonDeps) {
    super();
    this.now = deps.now ?? Date.now;
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    if (
      !(await requireMemberPermission(
        interaction,
        ANY_MOD_PERMISSION.flags,
        ANY_MOD_PERMISSION.name,
      ))
    ) {
      return;
    }

    const button = parseSuggestButtonId(interaction.customId);
    if (!button) {
      await interaction.reply(
        ephemeral(
          buildSuggestionNotice(
            isSuggestUndoId(interaction.customId)
              ? UNDO_UNAVAILABLE_TEXT
              : OUT_OF_DATE_TEXT,
          ),
        ),
      );
      return;
    }

    if (button.kind === "undo") {
      await this.undo(interaction, button.caseId, button.batchId);
      return;
    }

    if (!(await this.deps.flow.enabled(interaction.guildId))) {
      await interaction.reply(
        ephemeral(buildSuggestionNotice(OUT_OF_DATE_TEXT)),
      );
      return;
    }

    switch (button.kind) {
      case "review":
        await this.review(interaction, button);
        return;
      case "add":
        await this.addAll(interaction, button.caseId, button.fingerprint);
        return;
      case "add-selected":
        await this.addSelected(interaction, button.caseId, button.fingerprint);
        return;
    }
  }

  private async review(
    interaction: ButtonInteraction<"cached">,
    button: Extract<SuggestButton, { kind: "review" }>,
  ): Promise<void> {
    const { flow } = this.deps;
    // defer: renders suggestion previews with avatar fetches
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const moderationCase = await flow.loadCase(
      interaction.guildId,
      button.caseId,
    );
    if (!moderationCase) {
      await interaction.editReply(buildSuggestionNotice(CASE_GONE_TEXT));
      return;
    }

    const addOtherProofId = buildAddProofCustomId([moderationCase.caseId]);
    const access = viewerAccessFromMember(interaction.member, flow.deps.logger);
    const suggestions = await flow.compute(moderationCase, access);
    if (suggestions.length === 0) {
      await interaction.editReply(
        buildNothingLeft(moderationCase.caseId, addOtherProofId),
      );
      return;
    }

    const items = await flow.renderItems(moderationCase, suggestions, access);
    const selected = new Set(
      suggestions.flatMap((s, i) => (preselected(s) ? [i] : [])),
    );
    await interaction.editReply(
      buildPicker(
        {
          caseId: moderationCase.caseId,
          fingerprint: flow.fingerprint(suggestions),
          targetId: moderationCase.userId,
          targetName: moderationCase.userTag,
          actionType: moderationCase.actionType,
          items,
          addOtherProofId,
        },
        selected,
      ),
    );
    flow.metrics.recordShown(
      button.fingerprint === null ? "modlog" : "review",
      { userId: interaction.user.id, guildId: interaction.guildId },
    );
  }

  /** The clicker's own suggestions, or null after telling them the set changed. */
  private async current(
    interaction: ButtonInteraction<"cached">,
    moderationCase: ModerationCase,
    fingerprint: string,
    changedText: string,
  ): Promise<ProofSuggestion[] | null> {
    const { flow } = this.deps;
    const access = viewerAccessFromMember(interaction.member, flow.deps.logger);
    const suggestions = await flow.compute(moderationCase, access);
    if (flow.fingerprint(suggestions) !== fingerprint) {
      const includingSaved = await flow.compute(moderationCase, access, true);
      if (flow.fingerprint(includingSaved) === fingerprint) {
        return includingSaved;
      }
      await interaction.followUp(ephemeral(buildSuggestionNotice(changedText)));
      return null;
    }
    return suggestions;
  }

  private async addAll(
    interaction: ButtonInteraction<"cached">,
    caseId: string,
    fingerprint: string,
  ): Promise<void> {
    const { flow } = this.deps;
    // defer: resolves up to 10 message links (REST + up to 5 s waiting for message log posts) and posts overflow proof replies
    await interaction.deferUpdate();

    const moderationCase = await flow.loadCase(interaction.guildId, caseId);
    if (!moderationCase) {
      await interaction.followUp(
        ephemeral(buildSuggestionNotice(CASE_GONE_TEXT, Color.Error)),
      );
      return;
    }

    // The response showed the executor's suggestions; another mod may see different channels.
    const changedText =
      moderationCase.executorId === interaction.user.id
        ? SUGGESTIONS_CHANGED_TEXT
        : SUGGESTIONS_DIFFER_TEXT;
    const suggestions = await this.current(
      interaction,
      moderationCase,
      fingerprint,
      changedText,
    );
    if (!suggestions) {
      flow.metrics.recordAdded(
        "response",
        "changed",
        { userId: interaction.user.id, guildId: interaction.guildId },
        0,
      );
      return;
    }

    const result = await flow.add({
      moderationCase,
      chosen: suggestions,
      authorId: interaction.user.id,
      surface: "response",
      exceptMessageId: interaction.message.id,
    });

    // A block left stale by an add from the picker corrects itself on the next click.
    if (
      result.kind === "added" ||
      result.kind === "already_added" ||
      result.kind === "nothing_linked"
    ) {
      await this.refreshResponse(interaction, moderationCase);
    }
    await interaction.followUp(ephemeral(buildSuggestionAddResult(result)));
  }

  /** Best effort: the proof is saved and the mod log entry shows it either way. */
  private async refreshResponse(
    interaction: ButtonInteraction<"cached">,
    moderationCase: ModerationCase,
  ): Promise<void> {
    const { caseId } = moderationCase;
    try {
      const { flow } = this.deps;
      const suggestions = await flow
        .compute(
          moderationCase,
          viewerAccessFromMember(interaction.member, flow.deps.logger),
        )
        .catch((err: unknown) => {
          // The proof section still needs refreshing; the block is dropped instead.
          flow.deps.logger.warn(
            { err, guildId: interaction.guildId, caseId },
            "Failed to recompute suggested proof for the response",
          );
          return [];
        });
      const rebuilt = await rebuildResponseWithProof(
        this.deps.response,
        interaction.guildId,
        interaction.message,
        [caseId],
        this.now(),
        suggestions.length === 0
          ? []
          : buildResponseSuggestionBlock({
              caseId,
              fingerprint: flow.fingerprint(suggestions),
              suggestions,
              targetName: moderationCase.userTag,
              actionType: moderationCase.actionType,
            }),
      );
      if (rebuilt) {
        await interaction.editReply(rebuilt);
      }
    } catch (err) {
      this.deps.flow.deps.logger.warn(
        { err, guildId: interaction.guildId, caseId },
        "Failed to refresh the response after adding suggested proof",
      );
    }
  }

  private async addSelected(
    interaction: ButtonInteraction<"cached">,
    caseId: string,
    fingerprint: string,
  ): Promise<void> {
    const { flow } = this.deps;
    const values = selectedInPicker(postedOf(interaction));
    if (values === null) {
      await interaction.reply(
        ephemeral(buildSuggestionNotice(OUT_OF_DATE_TEXT)),
      );
      return;
    }
    if (values.length === 0) {
      await interaction.reply(
        ephemeral(buildSuggestionNotice(NOTHING_SELECTED_TEXT)),
      );
      return;
    }

    // defer: resolves up to 10 message links (REST + up to 5 s waiting for message log posts) and posts overflow proof replies
    await interaction.deferUpdate();

    const moderationCase = await flow.loadCase(interaction.guildId, caseId);
    if (!moderationCase) {
      await interaction.editReply({
        ...buildSuggestionNotice(CASE_GONE_TEXT, Color.Error),
        attachments: [],
      });
      return;
    }

    const suggestions = await this.current(
      interaction,
      moderationCase,
      fingerprint,
      SUGGESTIONS_CHANGED_TEXT,
    );
    const chosen = suggestions && chosenFrom(values, suggestions);
    if (!chosen) {
      if (suggestions) {
        await interaction.followUp(
          ephemeral(buildSuggestionNotice(OUT_OF_DATE_TEXT)),
        );
      }
      flow.metrics.recordAdded(
        "review",
        "changed",
        { userId: interaction.user.id, guildId: interaction.guildId },
        0,
      );
      return;
    }

    const result = await flow.add({
      moderationCase,
      chosen,
      authorId: interaction.user.id,
      surface: "review",
    });
    // Replaces the picker, dropping its previews.
    await interaction.editReply({
      ...buildSuggestionAddResult(result),
      attachments: [],
    });
  }

  private async undo(
    interaction: ButtonInteraction<"cached">,
    caseId: string,
    batchId: string,
  ): Promise<void> {
    const { flow } = this.deps;
    const links = linksFromAddedText(firstText(postedOf(interaction)));
    const retry = { caseId, batchId };

    // defer: removes N proof rows, each edits the mod log entry
    await interaction.deferUpdate();

    let result: Awaited<
      ReturnType<SuggestionFlow["deps"]["caseProofService"]["undoBatch"]>
    >;
    try {
      result = await flow.deps.caseProofService.undoBatch({
        guildId: interaction.guildId,
        caseId,
        batchId,
        actorId: interaction.user.id,
      });
    } catch (err) {
      // Logged here instead of the router, which would answer a second time.
      flow.deps.logger.error(
        { err, guildId: interaction.guildId, caseId, batchId },
        "Failed to undo suggested proof",
      );
      flow.metrics.recordUndone("failed", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
      });
      await interaction.editReply(
        buildUndoResult(UNDO_ERROR_TEXT, Color.Error, retry),
      );
      return;
    }

    if (result.ok) {
      flow.metrics.recordUndone("ok", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
      });
      await interaction.editReply(
        buildUndoResult(undoneText(caseId, links), Color.Success),
      );
      return;
    }

    const error = result.val;
    flow.metrics.recordUndone(error.kind, {
      userId: interaction.user.id,
      guildId: interaction.guildId,
    });
    switch (error.kind) {
      case "gone":
        await interaction.editReply(
          buildUndoResult(UNDO_GONE_TEXT, Color.Info),
        );
        return;
      case "not_allowed":
        await interaction.followUp(
          ephemeral(buildSuggestionNotice(UNDO_NOT_ALLOWED_TEXT, Color.Error)),
        );
        return;
      case "failed":
        await interaction.editReply(
          buildUndoResult(
            undoFailedText(error.removed, error.remaining),
            Color.Warning,
            retry,
          ),
        );
        return;
    }
  }
}
