import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import pino from "pino";
import { Ok } from "ts-results";

import { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { Reason } from "@/features/moderation/shared/domain/value-objects/Reason";
import customIds from "@/interactions/customIds";

import type { ReasonUpdateService } from "../../application/ReasonUpdateService";
import { ReasonCommand } from "./ReasonCommand";

const GUILD = "187450744427773963";
const MOD = "150443906511667200";
const TEMPLATE_TEXT = "Spamming in channels (rule 3).";

function makeCase(reason: string | null): ModerationCase {
  return new ModerationCase(
    GUILD,
    "4822",
    ActionType.Ban,
    new Date(),
    "912345678901234567",
    "spambot",
    MOD,
    reason ? Reason.create(reason).unwrap() : null,
  );
}

function makeInteraction(reason: string, updateDm: boolean | null = null) {
  const collector = {
    handlers: {} as Record<string, (...args: unknown[]) => Promise<void>>,
    on(event: string, fn: (...args: unknown[]) => Promise<void>) {
      this.handlers[event] = fn;
      return this;
    },
    stop: mock(() => undefined),
  };
  return {
    collector,
    guildId: GUILD,
    id: "1",
    user: { id: MOD },
    inCachedGuild: () => true,
    options: {
      getString: (name: string) => (name === "case" ? "4822" : reason),
      getBoolean: () => updateDm,
    },
    reply: mock(async () => ({
      createMessageComponentCollector: () => collector,
    })),
    deferReply: mock(async () => undefined),
    editReply: mock(async () => undefined),
  };
}

function updateResult(dmOutcome: "updated" | "failed" | null) {
  return Ok({
    updatedCases: [makeCase(TEMPLATE_TEXT)],
    errors: [],
    dmUpdates: dmOutcome ? [{ caseId: "4822", outcome: dmOutcome }] : [],
    modLogUpdates: [{ caseId: "4822", outcome: "updated" as const }],
  });
}

describe("ReasonCommand", () => {
  let checkExistingReasons: ReturnType<typeof mock>;
  let updateReasons: ReturnType<typeof mock>;
  let resolve: ReturnType<typeof mock>;
  let recordUse: ReturnType<typeof mock>;
  let command: ReasonCommand;

  beforeEach(() => {
    checkExistingReasons = mock(async () =>
      Ok({ cases: [makeCase(null)], hasExistingReasons: false }),
    );
    updateReasons = mock(async () => updateResult("updated"));
    resolve = mock(async () => ({
      text: TEMPLATE_TEXT,
      template: { id: "11", shortcut: "spam" },
      unknownShortcut: null,
      source: "shortcut",
      unresolved: null,
    }));
    recordUse = mock(async () => undefined);
    command = new ReasonCommand(
      { checkExistingReasons, updateReasons } as unknown as ReasonUpdateService,
      { resolve, recordUse },
      pino({ level: "silent" }),
    );
  });

  async function run(interaction: ReturnType<typeof makeInteraction>) {
    await command.handler(
      interaction as unknown as ChatInputCommandInteraction,
    );
  }

  test("has update_dm and template autocomplete on the reason", () => {
    const options = command.command.options as {
      name: string;
      autocomplete?: boolean;
      type: number;
    }[];
    expect(options.find((o) => o.name === "reason")?.autocomplete).toBe(true);
    expect(options.find((o) => o.name === "update_dm")).toBeDefined();
  });

  test("expands the template, updates the DM and records the use", async () => {
    const interaction = makeInteraction("!spam", true);

    await run(interaction);

    expect(resolve).toHaveBeenCalledWith(GUILD, "!spam");
    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(updateReasons).toHaveBeenCalledWith({
      guildId: GUILD,
      executorId: MOD,
      caseRangeStr: "4822",
      reason: TEMPLATE_TEXT,
      onlyEmpty: false,
      updateDm: true,
    });
    expect(recordUse).toHaveBeenCalledWith(GUILD, "11");
    const [{ embeds }] = interaction.editReply.mock.calls[0] as unknown as [
      { embeds: EmbedBuilder[] },
    ];
    expect(JSON.stringify(embeds[0]?.toJSON())).toContain(
      "Updated the DM with the new reason.",
    );
  });

  test("update_dm defaults to off", async () => {
    await run(makeInteraction("plain reason"));

    expect(updateReasons).toHaveBeenCalledWith(
      expect.objectContaining({ updateDm: false }),
    );
  });

  test("refuses an old or edited template pick", async () => {
    resolve.mockResolvedValueOnce({
      text: "!spam · Spamming…",
      template: null,
      unknownShortcut: null,
      source: "none",
      unresolved: { kind: "stale_label", input: "!spam · Spamming…" },
    });
    const interaction = makeInteraction("!spam · Spamming…");

    await run(interaction);

    expect(updateReasons).not.toHaveBeenCalled();
    expect(checkExistingReasons).not.toHaveBeenCalled();
    const [reply] = interaction.reply.mock.calls[0] as unknown as [
      { flags: number },
    ];
    expect(reply.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
    expect(JSON.stringify(reply)).toContain("old or edited template pick");
  });

  test("refuses a reason that's too long after expanding", async () => {
    resolve.mockResolvedValueOnce({
      text: "x".repeat(3042),
      template: { id: "11", shortcut: "spam" },
      unknownShortcut: null,
      source: "shortcut",
      unresolved: null,
    });
    const interaction = makeInteraction("!spam more");

    await run(interaction);

    expect(updateReasons).not.toHaveBeenCalled();
    expect(JSON.stringify(interaction.reply.mock.calls[0])).toContain(
      "after expanding `!spam`; the limit is 3,000. Shorten the extra text by 42 characters.",
    );
  });

  describe("overwrite confirmation", () => {
    beforeEach(() => {
      checkExistingReasons.mockResolvedValue(
        Ok({ cases: [makeCase("Old")], hasExistingReasons: true }),
      );
    });

    function confirmButton(
      userId = MOD,
      action: "override" | "empty" | "cancel" = "override",
    ) {
      return {
        user: { id: userId },
        customId: customIds.reasonConfirmButton.compile({
          userId: "0",
          buttonId: "0",
          action,
        }),
        deferUpdate: mock(async () => undefined),
        editReply: mock(async () => undefined),
        update: mock(async () => undefined),
        reply: mock(async () => undefined),
      };
    }

    test("acknowledges with an Updating state, then shows the result", async () => {
      const interaction = makeInteraction("!spam", true);
      await run(interaction);
      const button = confirmButton();

      await interaction.collector.handlers.collect?.(button);

      const [ack] = button.update.mock.calls[0] as unknown as [
        { embeds: EmbedBuilder[]; components: unknown[] },
      ];
      expect(ack.embeds[0]?.toJSON().title).toBe("Updating reasons…");
      expect(ack.components).toEqual([]);
      expect(button.deferUpdate).not.toHaveBeenCalled();
      expect(updateReasons).toHaveBeenCalledWith(
        expect.objectContaining({ onlyEmpty: false, updateDm: true }),
      );
      expect(recordUse).toHaveBeenCalledWith(GUILD, "11");
      expect(button.editReply).toHaveBeenCalledTimes(1);
      expect(interaction.collector.stop).toHaveBeenCalledTimes(1);
    });

    test("a second click can't start a second update", async () => {
      let release: () => void = () => undefined;
      updateReasons.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(updateResult(null));
          }),
      );
      const interaction = makeInteraction("!spam");
      await run(interaction);
      const first = confirmButton();
      const second = confirmButton();

      const running = interaction.collector.handlers.collect?.(first);
      await interaction.collector.handlers.collect?.(second);
      release();
      await running;

      expect(updateReasons).toHaveBeenCalledTimes(1);
      expect(second.update).not.toHaveBeenCalled();
      expect(second.reply).toHaveBeenCalledWith({
        content: "These cases are already being updated.",
        flags: MessageFlags.Ephemeral,
      });
    });

    test("a failed update shows an error and stops the collector", async () => {
      updateReasons.mockRejectedValueOnce(new Error("connection lost"));
      const interaction = makeInteraction("!spam");
      await run(interaction);
      const button = confirmButton();

      await interaction.collector.handlers.collect?.(button);

      expect(button.editReply).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(button.editReply.mock.calls[0])).toContain(
        "Something went wrong updating these cases.",
      );
      expect(interaction.collector.stop).toHaveBeenCalledTimes(1);
    });

    test("cancel after an update started doesn't claim it was cancelled", async () => {
      let release: () => void = () => undefined;
      updateReasons.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(updateResult(null));
          }),
      );
      const interaction = makeInteraction("!spam");
      await run(interaction);
      const cancel = confirmButton(MOD, "cancel");

      const running = interaction.collector.handlers.collect?.(confirmButton());
      await interaction.collector.handlers.collect?.(cancel);
      release();
      await running;

      expect(cancel.update).not.toHaveBeenCalled();
      expect(cancel.reply).toHaveBeenCalledWith({
        content: "These cases are already being updated.",
        flags: MessageFlags.Ephemeral,
      });
    });
  });
});
