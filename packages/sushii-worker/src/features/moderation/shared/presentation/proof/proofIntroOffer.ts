import type { RepliableInteraction } from "discord.js";

export { PROOF_INTRO_ID } from "@/features/prompts/definitions/proofIntro/message";

/** Best-effort follow-up sent after the main response; never throws. */
export interface PromptOffer {
  offer(
    interaction: RepliableInteraction<"cached">,
    promptId: string,
  ): Promise<void>;
}
