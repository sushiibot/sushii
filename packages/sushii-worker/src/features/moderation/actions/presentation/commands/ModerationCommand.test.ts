import { describe, expect, mock, test } from "bun:test";
import type { ChatInputCommandInteraction } from "discord.js";
import pino from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { ExpandResult } from "@/features/moderation/reason-templates/domain/ReasonExpander";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { COMMAND_CONFIGS } from "@/features/moderation/shared/presentation/commands/ModerationCommandConstants";

import { UNRESOLVED_TEMPLATE_MESSAGE } from "../components/reasonFormSubmit";
import {
  GUILD,
  MOD,
  TARGET,
  makeCase,
  makeEmojis,
  makeTarget,
  makeUser,
} from "../response/testFixtures";
import { ModerationCommand, expandedTooLongMessage } from "./ModerationCommand";

function expand(text: string, extra: Partial<ExpandResult> = {}): ExpandResult {
  return {
    text,
    template: null,
    unknownShortcut: null,
    source: "none",
    unresolved: null,
    ...extra,
  };
}

function setup(options: {
  configKey?: string;
  strings: Record<string, string | null>;
  expansion: ExpandResult | null;
  results?: Result<ModerationCase, string>[];
}) {
  const executeAction = mock(async () => options.results ?? [Ok(makeCase())]);
  const resolve = mock(async () => options.expansion);
  const recordUse = mock(async () => undefined);
  const shouldPromptSave = mock(async () => false);
  const scheduleExpiry = mock(() => undefined);
  const metrics = {
    recordReasonResolved: mock(),
    recordSavePrompt: mock(),
  };

  const command = new ModerationCommand(
    COMMAND_CONFIGS[options.configKey ?? "BAN"],
    { executeAction } as never,
    {
      fetchTargets: mock(async () => Ok([makeTarget(TARGET, "spambot")])),
    } as never,
    { findByGuildId: mock(async () => null) } as never,
    { getEmojis: mock(async () => makeEmojis()) } as never,
    { resolve, recordUse, shouldPromptSave },
    pino({ level: "silent" }),
    scheduleExpiry,
    metrics,
  );

  const interaction = {
    guildId: GUILD,
    user: makeUser(MOD, "tzuyu"),
    member: null,
    inCachedGuild: () => true,
    options: {
      getString: (name: string) => options.strings[name] ?? null,
      getAttachment: () => null,
      getInteger: () => null,
      getChannel: () => null,
    },
    reply: mock(async (_o: unknown) => undefined),
    deferReply: mock(async () => undefined),
    editReply: mock(async (_o: unknown) => undefined),
  };

  return {
    run: () =>
      command.handler(interaction as unknown as ChatInputCommandInteraction),
    interaction,
    executeAction,
    resolve,
    recordUse,
    shouldPromptSave,
    scheduleExpiry,
    metrics,
  };
}

describe("ModerationCommand reason expansion", () => {
  test("an unresolved template pick refuses the action", async () => {
    const ctx = setup({
      strings: { users: TARGET, reason: "template:9" },
      expansion: expand("template:9", {
        unresolved: { kind: "token", input: "template:9" },
      }),
    });
    await ctx.run();

    expect(JSON.stringify(ctx.interaction.reply.mock.calls[0])).toContain(
      UNRESOLVED_TEMPLATE_MESSAGE,
    );
    expect(ctx.interaction.deferReply).not.toHaveBeenCalled();
    expect(ctx.executeAction).not.toHaveBeenCalled();
    expect(ctx.metrics.recordReasonResolved.mock.calls).toEqual([
      ["command", "refused"],
    ]);
  });

  test("too long after expanding refuses with the overflow", async () => {
    const ctx = setup({
      strings: { users: TARGET, reason: "!spam more" },
      expansion: expand("z".repeat(3042), {
        template: { id: "3", shortcut: "spam" },
        source: "shortcut",
      }),
    });
    await ctx.run();

    expect(JSON.stringify(ctx.interaction.reply.mock.calls[0])).toContain(
      "The reason is 3,042 characters after expanding `!spam`; the limit is 3,000. Shorten the extra text by 42 characters.",
    );
    expect(ctx.executeAction).not.toHaveBeenCalled();
  });

  test("uses the expanded text, records the template once and schedules expiry", async () => {
    const ctx = setup({
      strings: { users: TARGET, reason: "!spam" },
      expansion: expand("Spamming invite links", {
        template: { id: "3", shortcut: "spam" },
        source: "shortcut",
      }),
    });
    await ctx.run();

    const [action] = ctx.executeAction.mock.calls[0] as unknown as [
      { reason: { value: string } },
    ];
    expect(action.reason.value).toBe("Spamming invite links");
    expect(ctx.recordUse).toHaveBeenCalledTimes(1);
    expect(ctx.recordUse).toHaveBeenCalledWith(GUILD, "3");
    expect(ctx.shouldPromptSave).not.toHaveBeenCalled();
    expect(JSON.stringify(ctx.interaction.editReply.mock.calls[0])).toContain(
      "Used template `!spam`",
    );
    expect(ctx.scheduleExpiry).toHaveBeenCalledTimes(1);
    expect(ctx.metrics.recordReasonResolved.mock.calls).toEqual([
      ["command", "shortcut"],
    ]);
    expect(ctx.metrics.recordSavePrompt).not.toHaveBeenCalled();
  });

  test("failed bookkeeping after the action never hides the response", async () => {
    const ctx = setup({
      strings: { users: TARGET, reason: "!spam" },
      expansion: expand("Spamming", {
        template: { id: "3", shortcut: "spam" },
      }),
    });
    ctx.recordUse.mockImplementation(async () => {
      throw new Error("db down");
    });
    await ctx.run();

    expect(ctx.interaction.editReply).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(ctx.interaction.editReply.mock.calls[0])).toContain(
      "modAction/reason/edit/4822",
    );
  });

  test("a failed save prompt check leaves the prompt out", async () => {
    const ctx = setup({
      strings: { users: TARGET, reason: "Raid" },
      expansion: expand("Raid"),
    });
    ctx.shouldPromptSave.mockImplementation(async () => {
      throw new Error("db down");
    });
    await ctx.run();

    expect(
      JSON.stringify(ctx.interaction.editReply.mock.calls[0]),
    ).not.toContain("modAction/save/");
  });

  test("no template use is recorded when every target failed", async () => {
    const ctx = setup({
      strings: { users: TARGET, reason: "!spam" },
      expansion: expand("Spamming", {
        template: { id: "3", shortcut: "spam" },
      }),
      results: [Err("Missing permissions")],
    });
    await ctx.run();

    expect(ctx.recordUse).not.toHaveBeenCalled();
    expect(ctx.scheduleExpiry).not.toHaveBeenCalled();
  });

  test("a typed reason asks whether to prompt saving it", async () => {
    const ctx = setup({
      strings: { users: TARGET, reason: "Raid" },
      expansion: expand("Raid"),
    });
    await ctx.run();

    expect(ctx.shouldPromptSave).toHaveBeenCalledWith(GUILD, "Raid");
    expect(ctx.metrics.recordReasonResolved.mock.calls).toEqual([
      ["command", "typed"],
    ]);
  });

  test("a shown save prompt is counted once", async () => {
    const ctx = setup({
      strings: { users: TARGET, reason: "Raid" },
      expansion: expand("Raid"),
    });
    ctx.shouldPromptSave.mockImplementation(async () => true);
    await ctx.run();

    expect(JSON.stringify(ctx.interaction.editReply.mock.calls[0])).toContain(
      "modAction/save/",
    );
    expect(ctx.metrics.recordSavePrompt.mock.calls).toEqual([["shown"]]);
  });

  test("notes are never expanded", async () => {
    const ctx = setup({
      configKey: "NOTE",
      strings: { users: TARGET, note: "!spam" },
      expansion: null,
      results: [
        Ok(
          makeCase({ actionType: ActionType.Note, dm: null, reason: "!spam" }),
        ),
      ],
    });
    await ctx.run();

    expect(ctx.resolve).not.toHaveBeenCalled();
    const [action] = ctx.executeAction.mock.calls[0] as unknown as [
      { reason: { value: string } },
    ];
    expect(action.reason.value).toBe("!spam");
    expect(ctx.shouldPromptSave).not.toHaveBeenCalled();
    expect(ctx.metrics.recordReasonResolved).not.toHaveBeenCalled();
  });

  test("template use is recorded even when the reply edit fails", async () => {
    const ctx = setup({
      strings: { users: TARGET, reason: "!spam" },
      expansion: expand("Spamming", {
        template: { id: "3", shortcut: "spam" },
      }),
    });
    ctx.interaction.editReply.mockImplementation(async () => {
      throw new Error("Unknown Webhook");
    });

    await expect(ctx.run()).rejects.toThrow("Unknown Webhook");
    expect(ctx.recordUse).toHaveBeenCalledTimes(1);
  });

  test("the overflow message names a recent reason as one", () => {
    expect(expandedTooLongMessage(3001, null)).toContain(
      "after expanding the recent reason",
    );
  });

  test("the overflow message names the template when it has no shortcut", () => {
    expect(expandedTooLongMessage(3001, { id: "1", shortcut: null })).toContain(
      "after expanding the template",
    );
  });
});
