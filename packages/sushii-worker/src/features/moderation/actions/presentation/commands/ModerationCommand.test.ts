import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type {
  AttachmentBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import pino from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { ExpandResult } from "@/features/moderation/reason-templates/domain/ReasonExpander";
import {
  BanAction,
  KickAction,
  SoftbanAction,
} from "@/features/moderation/shared/domain/entities/ModerationAction";
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
import {
  ModerationCommand,
  actionPurgeSeconds,
  expandedTooLongMessage,
} from "./ModerationCommand";

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

const REHOSTED_URL =
  "https://cdn.discordapp.com/attachments/9/8/proof_1.png?ex=a&is=b&hm=c&";

const PROOF = {
  id: "800000000000000000",
  name: "proof 1.png",
  size: 100,
  url: "https://cdn.discordapp.com/ephemeral-attachments/1/2/proof%201.png?ex=a&is=b&hm=c&",
};

/** A posted response whose only file is referenced by its gallery, as Discord returns it. */
function galleryOnlyReply(url: string, attachmentId = "910000000000000000") {
  return {
    id: "900000000000000000",
    attachments: new Map(),
    components: [
      {
        toJSON: () => ({
          type: 17,
          components: [
            {
              type: 12,
              items: [{ media: { url, attachment_id: attachmentId } }],
            },
          ],
        }),
      },
    ],
  };
}

function setup(options: {
  configKey?: string;
  strings: Record<string, string | null>;
  expansion: ExpandResult | null;
  results?: Result<ModerationCase, string>[];
  attachment?: { id: string; name: string; size: number; url: string };
}) {
  const executeAction = mock(async () => options.results ?? [Ok(makeCase())]);
  const addActionProof = mock(async () => undefined);
  const resolve = mock(async () => options.expansion);
  const recordUse = mock(async () => undefined);
  const shouldPromptSave = mock(async () => false);
  const scheduleExpiry = mock(() => undefined);
  const offer = mock(async () => undefined);
  const attach = mock(async (_input: unknown) => undefined);
  const metrics = {
    recordReasonResolved: mock(),
    recordSavePrompt: mock(),
  };

  const command = new ModerationCommand(
    COMMAND_CONFIGS[options.configKey ?? "BAN"],
    { executeAction, addActionProof } as never,
    {
      fetchTargets: mock(async () => Ok([makeTarget(TARGET, "spambot")])),
    } as never,
    { findByGuildId: mock(async () => null) } as never,
    { getEmojis: mock(async () => makeEmojis()) } as never,
    { resolve, recordUse, shouldPromptSave },
    pino({ level: "silent" }),
    { offer },
    scheduleExpiry,
    metrics,
    { attach },
  );

  const interaction = {
    guildId: GUILD,
    user: makeUser(MOD, "tzuyu"),
    member: null,
    inCachedGuild: () => true,
    options: {
      getString: (name: string) => options.strings[name] ?? null,
      getAttachment: () => options.attachment ?? null,
      getInteger: () => null,
      getChannel: () => null,
    },
    reply: mock(async (_o: unknown) => undefined),
    deferReply: mock(async () => undefined),
    editReply: mock(async (_o: unknown) => galleryOnlyReply(REHOSTED_URL)),
    attachmentSizeLimit: 1000,
  };

  return {
    run: () =>
      command.handler(interaction as unknown as ChatInputCommandInteraction),
    interaction,
    executeAction,
    addActionProof,
    resolve,
    recordUse,
    shouldPromptSave,
    scheduleExpiry,
    metrics,
    offer,
    attach,
  };
}

describe("ModerationCommand suggested proof", () => {
  afterEach(() => {
    mock.restore();
  });

  test("asks for suggestions after a single-target response is posted", async () => {
    const ctx = setup({ strings: { users: TARGET }, expansion: null });
    await ctx.run();

    expect(ctx.attach).toHaveBeenCalledTimes(1);
    expect(ctx.attach.mock.calls[0][0]).toMatchObject({
      interaction: ctx.interaction,
      purgeWindowSeconds: 0,
    });
    expect(ctx.attach.mock.invocationCallOrder[0]).toBeGreaterThan(
      ctx.interaction.editReply.mock.invocationCallOrder[0],
    );
  });

  test("skips responses that already carry proof or failed", async () => {
    const withFile = setup({
      strings: { users: TARGET },
      expansion: null,
      attachment: { ...PROOF, name: "log.txt" },
    });
    await withFile.run();
    expect(withFile.attach).not.toHaveBeenCalled();

    const failed = setup({
      strings: { users: TARGET },
      expansion: null,
      results: [Err("Missing permissions")],
    });
    await failed.run();
    expect(failed.attach).not.toHaveBeenCalled();
  });

  test("skips multi-target actions", async () => {
    const ctx = setup({
      strings: { users: TARGET },
      expansion: null,
      results: [Ok(makeCase()), Ok(makeCase({ caseId: "4823" }))],
    });
    await ctx.run();
    expect(ctx.attach).not.toHaveBeenCalled();
  });
});

describe("actionPurgeSeconds", () => {
  const user = makeUser(MOD, "tzuyu");
  test("matches what the pipeline passes to Discord", () => {
    expect(
      actionPurgeSeconds(
        new BanAction(GUILD, user, null, null, "unspecified", null, 1),
      ),
    ).toBe(86_400);
    expect(
      actionPurgeSeconds(new BanAction(GUILD, user, null, null, "unspecified")),
    ).toBe(0);
    expect(
      actionPurgeSeconds(
        new SoftbanAction(GUILD, user, null, null, "unspecified", 3600),
      ),
    ).toBe(3600);
    expect(
      actionPurgeSeconds(
        new KickAction(GUILD, user, null, null, "unspecified"),
      ),
    ).toBe(0);
  });
});

describe("ModerationCommand proof intro", () => {
  afterEach(() => {
    mock.restore();
  });

  test("is offered after a case is made and its proof saved", async () => {
    const ctx = setup({
      strings: { users: TARGET },
      expansion: null,
      attachment: { ...PROOF, name: "log.txt" },
    });
    await ctx.run();

    expect(ctx.addActionProof).toHaveBeenCalledTimes(1);
    expect(ctx.offer).toHaveBeenCalledWith(ctx.interaction, "proof_intro");
    const offerOrder = ctx.offer.mock.invocationCallOrder[0];
    expect(offerOrder).toBeGreaterThan(
      ctx.addActionProof.mock.invocationCallOrder[0],
    );
    expect(offerOrder).toBeGreaterThan(
      ctx.interaction.editReply.mock.invocationCallOrder[0],
    );
  });

  test("is offered without proof too", async () => {
    const ctx = setup({ strings: { users: TARGET }, expansion: null });
    await ctx.run();

    expect(ctx.offer).toHaveBeenCalledWith(ctx.interaction, "proof_intro");
  });

  test("isn't offered when every target failed", async () => {
    const ctx = setup({
      strings: { users: TARGET },
      expansion: null,
      results: [Err("Missing permissions")],
    });
    await ctx.run();

    expect(ctx.interaction.editReply).toHaveBeenCalledTimes(1);
    expect(ctx.offer).not.toHaveBeenCalled();
  });

  test("isn't offered when the action is refused before it runs", async () => {
    const ctx = setup({
      configKey: "WARN",
      strings: { users: TARGET },
      expansion: null,
    });
    await ctx.run();

    expect(ctx.interaction.reply).toHaveBeenCalledTimes(1);
    expect(ctx.offer).not.toHaveBeenCalled();
  });
});

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
      "Template `!spam`",
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

describe("ModerationCommand attachment re-hosting", () => {
  afterEach(() => {
    mock.restore();
  });

  test("uploads media with the response and saves the response's URL on the cases", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3])),
    );
    const ctx = setup({
      strings: { users: TARGET },
      expansion: null,
      attachment: PROOF,
    });
    await ctx.run();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [reply] = ctx.interaction.editReply.mock.calls[0] as [
      { files?: AttachmentBuilder[] },
    ];
    expect(reply.files?.map((f) => f.name)).toEqual(["proof_1.png"]);
    expect(JSON.stringify(reply)).toContain("attachment://proof_1.png");
    expect(ctx.addActionProof).toHaveBeenCalledWith(
      [makeCase()],
      MOD,
      REHOSTED_URL,
    );
  });

  test("reads the URL from the gallery when Discord renamed the file", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3])),
    );
    const renamed =
      "https://cdn.discordapp.com/attachments/9/8/proof_1_1.png?ex=a&is=b&hm=c&";
    const ctx = setup({
      strings: { users: TARGET },
      expansion: null,
      attachment: PROOF,
    });
    ctx.interaction.editReply.mockImplementationOnce(async () =>
      galleryOnlyReply(renamed),
    );
    await ctx.run();

    expect(ctx.addActionProof).toHaveBeenCalledWith([makeCase()], MOD, renamed);
  });

  test("a file over the upload limit keeps the original link", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");
    const ctx = setup({
      strings: { users: TARGET },
      expansion: null,
      attachment: { ...PROOF, size: 5000 },
    });
    await ctx.run();

    expect(fetchSpy).not.toHaveBeenCalled();
    const [reply] = ctx.interaction.editReply.mock.calls[0] as [
      { files?: unknown },
    ];
    expect(reply.files).toBeUndefined();
    expect(ctx.addActionProof).toHaveBeenCalledWith(
      [makeCase()],
      MOD,
      PROOF.url,
    );
  });

  test("a failed download still sends the response", async () => {
    spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    const ctx = setup({
      strings: { users: TARGET },
      expansion: null,
      attachment: PROOF,
    });
    await ctx.run();

    const [reply] = ctx.interaction.editReply.mock.calls[0] as [
      { files?: unknown },
    ];
    expect(reply.files).toBeUndefined();
    expect(ctx.addActionProof).toHaveBeenCalledWith(
      [makeCase()],
      MOD,
      PROOF.url,
    );
  });

  test("a failed upload falls back to the response without the file", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3])),
    );
    const ctx = setup({
      strings: { users: TARGET },
      expansion: null,
      attachment: PROOF,
    });
    ctx.interaction.editReply.mockImplementationOnce(async () => {
      throw new Error("Request entity too large");
    });
    await ctx.run();

    expect(ctx.interaction.editReply).toHaveBeenCalledTimes(2);
    const [fallback] = ctx.interaction.editReply.mock.calls[1] as [
      { files?: unknown },
    ];
    expect(fallback.files).toBeUndefined();
    expect(JSON.stringify(fallback)).not.toContain("attachment://");
    expect(ctx.addActionProof).toHaveBeenCalledWith(
      [makeCase()],
      MOD,
      PROOF.url,
    );
  });

  test("files a gallery can't show aren't re-hosted", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");
    const ctx = setup({
      strings: { users: TARGET },
      expansion: null,
      attachment: { ...PROOF, name: "log.txt" },
    });
    await ctx.run();

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("ModerationCommand action-time proof", () => {
  afterEach(() => {
    mock.restore();
  });

  test("the first response shows the file as proof and registers for staleness", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3])),
    );
    const ctx = setup({
      strings: { users: TARGET },
      expansion: null,
      attachment: PROOF,
    });
    await ctx.run();

    const sent = JSON.stringify(ctx.interaction.editReply.mock.calls[0]);
    expect(sent).toContain(`<@${MOD}>`);
    expect(sent).toContain("1 file");
    expect(sent).not.toContain("None yet");
    expect(ctx.scheduleExpiry).toHaveBeenCalledWith(
      ctx.interaction,
      expect.anything(),
      {
        guildId: GUILD,
        caseIds: [makeCase().caseId],
        messageId: "900000000000000000",
      },
    );
  });

  test("a file a gallery can't show is linked from the proof entry", async () => {
    const ctx = setup({
      strings: { users: TARGET },
      expansion: null,
      attachment: {
        ...PROOF,
        name: "log.txt",
        url: "https://cdn.discordapp.com/x/log.txt",
      },
    });
    await ctx.run();

    expect(JSON.stringify(ctx.interaction.editReply.mock.calls[0])).toContain(
      "https://cdn.discordapp.com/x/log.txt",
    );
    expect(ctx.addActionProof).toHaveBeenCalledWith(
      [makeCase()],
      MOD,
      "https://cdn.discordapp.com/x/log.txt",
    );
  });

  test("no file, no proof row", async () => {
    const ctx = setup({ strings: { users: TARGET }, expansion: null });
    await ctx.run();
    expect(ctx.addActionProof).not.toHaveBeenCalled();
    expect(ctx.scheduleExpiry).toHaveBeenCalledTimes(1);
  });

  test("a failed proof save never fails the response", async () => {
    const ctx = setup({
      strings: { users: TARGET },
      expansion: null,
      attachment: { ...PROOF, name: "log.txt" },
    });
    ctx.addActionProof.mockImplementationOnce(async () => {
      throw new Error("db down");
    });
    await ctx.run();
    expect(ctx.interaction.editReply).toHaveBeenCalledTimes(1);
  });
});

describe("proof option", () => {
  test("every case command has it, described as never sent", () => {
    for (const config of Object.values(COMMAND_CONFIGS)) {
      const json = new ModerationCommand(
        config,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        pino({ level: "silent" }),
        {} as never,
      ).command as { options?: { name: string; description: string }[] };
      const names = json.options?.map((o) => o.name) ?? [];
      expect(names).toContain("proof");
      expect(names).not.toContain("attachment");
      expect(json.options?.find((o) => o.name === "proof")?.description).toBe(
        "Screenshot for mods. Never sent to the user.",
      );
    }
    expect(Object.keys(COMMAND_CONFIGS)).toHaveLength(9);
  });
});
