import type { ButtonBuilder } from "discord.js";
import { ActionRowBuilder } from "discord.js";

import { buildFeedbackPanelButton } from "@/features/feedback/presentation/views/FeedbackButton";
import { fallbackMention } from "@/shared/presentation/commandMentions";
import { buildSupportServerButton } from "@/shared/presentation/supportServer";
import Color from "@/utils/colors";

import type { PromptContent } from "../../domain/PromptDefinition";

export const PROOF_INTRO_ID = "proof_intro";

export function buildProofIntroContent(): PromptContent {
  const text =
    "## 🔒 New: reason and proof are separate\n" +
    "**Reason** is the only thing sent to the user by DM.\n" +
    "**Proof** (screenshots, links, notes) is for mods only. It's never DM'd and shows in full on the mod log entry.\n\n" +
    "**Add proof with:**\n" +
    `• the \`proof\` option on case commands like ${fallbackMention("ban")}\n` +
    "• the **Add proof** button on the response or mod log entry\n" +
    `• ${fallbackMention("proof")} for any case\n` +
    "• Right-click a message → **Apps** → **Add as proof**";

  return {
    text,
    accentColor: Color.Info,
    rows: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        buildFeedbackPanelButton("prompt.proof_intro"),
        buildSupportServerButton(),
      ),
    ],
  };
}
