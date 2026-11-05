import { describe, expect, test } from "bun:test";
import { ButtonStyle, ComponentType } from "discord.js";

import { SUPPORT_SERVER_URL } from "@/shared/presentation/supportServer";
import Color from "@/utils/colors";

import type { PromptInteraction } from "../../domain/PromptDefinition";
import { ALL_PROMPTS } from "../index";
import { proofIntroPrompt } from "./index";
import { buildProofIntroContent } from "./message";

describe("proof_intro prompt", () => {
  test("is a one-shot, per-user, explicit prompt that ends in January", async () => {
    expect(proofIntroPrompt).toMatchObject({
      id: "proof_intro",
      scope: "user",
      repeat: null,
      delivery: "explicit",
      activeUntil: new Date("2027-01-03T00:00:00Z"),
    });
    expect(await proofIntroPrompt.eligible({} as PromptInteraction)).toBe(true);
    expect(ALL_PROMPTS).toContain(proofIntroPrompt);
  });

  test("explains reason versus proof and every way to add proof", () => {
    const content = buildProofIntroContent();

    expect(content.accentColor).toBe(Color.Info);
    expect(content.text).toStartWith(
      "## 🔒 New: reason and proof are separate\n",
    );
    expect(content.text).toContain(
      "**Reason** is the only thing sent to the user by DM.",
    );
    expect(content.text).toContain(
      "**Proof** (screenshots, links, notes) is for mods only. It's never DM'd and shows in full on the mod log entry.",
    );
    expect(content.text).toContain(
      "• the `proof` option on case commands like `/ban`",
    );
    expect(content.text).toContain(
      "• the **Add proof** button on the response or mod log entry",
    );
    expect(content.text).toContain("• `/proof` for any case");
    expect(content.text).toContain(
      "• Right-click a message → **Apps** → **Add as proof**",
    );
  });

  test("has one row: feedback and the support server, no snooze or dismiss", () => {
    const rows = (buildProofIntroContent().rows ?? []).map((r) => r.toJSON());

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      type: ComponentType.ActionRow,
      components: [
        expect.objectContaining({
          custom_id: "feedback/panel/prompt.proof_intro",
          label: "Feedback",
          style: ButtonStyle.Secondary,
        }),
        expect.objectContaining({
          label: "Support server",
          style: ButtonStyle.Link,
          url: SUPPORT_SERVER_URL,
        }),
      ],
    });
  });
});
