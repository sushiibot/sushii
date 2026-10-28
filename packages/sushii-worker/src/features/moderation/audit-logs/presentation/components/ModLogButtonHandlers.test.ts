import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ButtonInteraction } from "discord.js";
import { ContainerBuilder, MessageFlags } from "discord.js";
import pino from "pino";
import { Ok } from "ts-results";

import type { CaseDmDeletionOutcome } from "@/features/moderation/shared/application/CaseDmDeletionService";
import { ModLogMessageService } from "@/features/moderation/shared/application/ModLogMessageService";
import { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { Reason } from "@/features/moderation/shared/domain/value-objects/Reason";

import { ModLogDeleteDMButtonHandler } from "./ModLogDeleteDMButtonHandler";
import { ModLogReasonButtonHandler } from "./ModLogReasonButtonHandler";

const GUILD = "187450744427773963";
const MOD = "150443906511667200";
const TARGET = "912345678901234567";
const DM = {
  channelId: "1029384756102938400",
  messageId: "1029384756102938401",
};
const INTERACTION_ID = "1558174981962080000";

function makeCase(
  options: { reason?: string | null; dm?: boolean } = {},
): ModerationCase {
  return new ModerationCase(
    GUILD,
    "4822",
    ActionType.Ban,
    new Date("2026-10-27T11:00:00.000Z"),
    TARGET,
    "spambot",
    MOD,
    options.reason ? Reason.create(options.reason).unwrap() : null,
    "1029384756102938499",
    [],
    options.dm === false ? null : DM,
  );
}

const rendered = {
  components: [new ContainerBuilder()],
  flags: MessageFlags.IsComponentsV2,
  allowedMentions: { parse: [] },
} as const;

const entryMessage = { id: "1029384756102938499", embeds: [], components: [] };

function makeService() {
  const service = {
    render: mock(async () => rendered),
    syncLegacyDeletedDm: mock(async (c: ModerationCase) => c),
    updateFromInteraction: mock(
      async (): Promise<"updated" | "failed"> => "updated",
    ),
  };
  return service as typeof service &
    Pick<
      ModLogMessageService,
      "render" | "syncLegacyDeletedDm" | "updateFromInteraction"
    >;
}

function makeButton(
  customId: string,
  submission?: unknown,
  message: unknown = entryMessage,
) {
  return {
    message,
    id: INTERACTION_ID,
    customId,
    guildId: GUILD,
    user: { id: MOD },
    member: { id: MOD },
    memberPermissions: {
      any: (_p: unknown): boolean => true,
    },
    inCachedGuild: () => true,
    guild: { members: { cache: new Map() } },
    client: { users: { cache: new Map() } },
    reply: mock(async () => undefined),
    update: mock(async () => undefined),
    followUp: mock(async () => undefined),
    showModal: mock(async () => undefined),
    awaitModalSubmit: mock(async () => submission),
  };
}

describe("ModLogDeleteDMButtonHandler", () => {
  let findById: ReturnType<typeof mock>;
  let deleteDms: ReturnType<typeof mock>;
  let render: ReturnType<typeof mock>;
  let service: ReturnType<typeof makeService>;
  let handler: ModLogDeleteDMButtonHandler;

  beforeEach(() => {
    findById = mock(async () => makeCase({ reason: "Spam" }));
    deleteDms = mock(
      async (): Promise<CaseDmDeletionOutcome[]> => [
        {
          caseId: "4822",
          result: "deleted",
          moderationCase: makeCase({ reason: "Spam" }).withDmDeleted(),
          modLog: null,
        },
      ],
    );
    service = makeService();
    render = service.render;
    handler = new ModLogDeleteDMButtonHandler(
      { findById },
      { deleteDms },
      service,
      pino({ level: "silent" }),
    );
  });

  async function click(customId: string) {
    const interaction = makeButton(customId);
    await handler.handleInteraction(
      interaction as unknown as ButtonInteraction,
    );
    return interaction;
  }

  test("routes legacy and new Delete DM buttons", () => {
    expect(
      handler.customIDMatch(
        `/modlog/rmDM/4822/${DM.channelId}/${DM.messageId}`,
      ),
    ).not.toBe(false);
    expect(handler.customIDMatch("modLog/dm/deleteConfirm/4822")).not.toBe(
      false,
    );
    expect(handler.customIDMatch("modLog/dm/cancel/4822")).not.toBe(false);
    expect(handler.customIDMatch("/modlog/reason/4822")).toBe(false);
  });

  test("the legacy button swaps in the confirm, converting the entry", async () => {
    const interaction = await click(
      `/modlog/rmDM/4822/${DM.channelId}/${DM.messageId}`,
    );

    expect(render).toHaveBeenCalledWith(expect.any(ModerationCase), {
      confirmDeleteDm: true,
      currentMessage: entryMessage,
    });
    expect(service.updateFromInteraction).toHaveBeenCalledWith(
      interaction,
      rendered,
    );
    expect(deleteDms).not.toHaveBeenCalled();
  });

  test("confirm deletes the DM and re-renders in place", async () => {
    const interaction = await click("modLog/dm/deleteConfirm/4822");

    expect(deleteDms).toHaveBeenCalledWith(GUILD, ["4822"], MOD, {
      skipModLogRefreshFor: ["4822"],
    });
    const [renderedCase] = render.mock.calls[0] as unknown as [ModerationCase];
    expect(renderedCase.dmDeleted).toBe(true);
    expect(service.updateFromInteraction).toHaveBeenCalledWith(
      interaction,
      rendered,
    );
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  test("a failed legacy conversion after the ack becomes a private note", async () => {
    service.updateFromInteraction.mockResolvedValueOnce("failed");

    const interaction = await click("modLog/dm/deleteConfirm/4822");

    expect(deleteDms).toHaveBeenCalledTimes(1);
    expect(interaction.update).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: "Deleted the DM, but this mod log entry couldn't be updated.",
      flags: MessageFlags.Ephemeral,
    });
  });

  test("a refused delete restores the buttons and says so privately", async () => {
    deleteDms.mockResolvedValueOnce([
      {
        caseId: "4822",
        result: "failed",
        moderationCase: makeCase({ reason: "Spam" }),
        modLog: null,
      },
    ]);

    const interaction = await click("modLog/dm/deleteConfirm/4822");

    expect(render).toHaveBeenCalledWith(expect.any(ModerationCase), {
      currentMessage: entryMessage,
    });
    expect(service.updateFromInteraction).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
  });

  test("cancel re-renders without deleting", async () => {
    await click("modLog/dm/cancel/4822");

    expect(deleteDms).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledWith(expect.any(ModerationCase), {
      confirmDeleteDm: false,
      currentMessage: entryMessage,
    });
    expect(service.updateFromInteraction).toHaveBeenCalledTimes(1);
  });

  test("a legacy Delete DM click on a case with no DM on record says so", async () => {
    findById.mockResolvedValueOnce(makeCase({ reason: "Spam", dm: false }));

    const interaction = await click(
      `/modlog/rmDM/4822/${DM.channelId}/${DM.messageId}`,
    );

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "There's no DM on record for this case.",
      flags: MessageFlags.Ephemeral,
    });
    expect(service.updateFromInteraction).not.toHaveBeenCalled();
  });

  test("syncs a legacy deleted DM before deciding on the confirm", async () => {
    service.syncLegacyDeletedDm.mockImplementationOnce(
      async (c: ModerationCase) => c.withDmDeleted(),
    );

    await click(`/modlog/rmDM/4822/${DM.channelId}/${DM.messageId}`);

    expect(service.syncLegacyDeletedDm).toHaveBeenCalledWith(
      expect.any(ModerationCase),
      entryMessage,
    );
    expect(render).toHaveBeenCalledWith(expect.any(ModerationCase), {
      confirmDeleteDm: false,
      currentMessage: entryMessage,
    });
  });

  test("a deleted case replies privately", async () => {
    findById.mockResolvedValueOnce(null);

    const interaction = await click("modLog/dm/cancel/4822");

    expect(service.updateFromInteraction).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
  });

  test("needs a mod permission", async () => {
    const interaction = makeButton("modLog/dm/deleteConfirm/4822");
    interaction.memberPermissions.any = () => false;

    await handler.handleInteraction(
      interaction as unknown as ButtonInteraction,
    );

    expect(deleteDms).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledTimes(1);
  });
});

function makeSubmission(text: string, options: string[] = []) {
  const fields = new Map<string, unknown>([
    ["reason", { customId: "reason", value: text }],
    ["reason_options", { customId: "reason_options", values: options }],
  ]);
  return {
    fields: {
      fields,
      getTextInputValue: () => text,
      getCheckboxGroup: () => options,
      getCheckbox: () => false,
      getStringSelectValues: () => [],
    },
    guildId: GUILD,
    user: { id: MOD },
    inCachedGuild: () => true,
    isFromMessage: () => true,
    reply: mock(async () => undefined),
    update: mock(async () => undefined),
    followUp: mock(async () => undefined),
  };
}

describe("ModLogReasonButtonHandler", () => {
  let updateReasons: ReturnType<typeof mock>;
  let render: ReturnType<typeof mock>;
  let findById: ReturnType<typeof mock>;
  let resolve: ReturnType<typeof mock>;
  let service: ReturnType<typeof makeService>;
  let templateCreate: ReturnType<typeof mock>;
  let handler: ModLogReasonButtonHandler;

  beforeEach(() => {
    findById = mock(async () => makeCase({ reason: null }));
    updateReasons = mock(async () =>
      Ok({
        updatedCases: [
          makeCase({ reason: "Raid" }).withReasonSetBy(MOD, new Date()),
        ],
        errors: [],
        dmUpdates: [],
        modLogUpdates: [{ caseId: "4822", outcome: "skipped" }],
      }),
    );
    service = makeService();
    render = service.render;
    templateCreate = mock(async () =>
      Ok({ id: "16", content: "Raid", shortcut: null } as never),
    );
    resolve = mock(async (_g: string, input: string | null) =>
      input
        ? {
            text: input,
            template: null,
            unknownShortcut: null,
            source: "none",
            unresolved: null,
          }
        : null,
    );
    handler = new ModLogReasonButtonHandler(
      { findById },
      { updateReasons },
      {
        getFormData: mock(async () => ({ last: null, templates: [] })),
        resolve,
        recordUse: mock(async () => undefined),
        create: templateCreate,
      } as never,
      service,
      {
        getEmojis: mock(async () => ({
          history: "",
          success: "",
          message_edit: "",
          fail: "",
        })),
      } as never,
      pino({ level: "silent" }),
    );
  });

  async function submit(
    submission: ReturnType<typeof makeSubmission>,
    message?: unknown,
  ) {
    const interaction = makeButton("/modlog/reason/4822", submission, message);
    await handler.handleInteraction(
      interaction as unknown as ButtonInteraction,
    );
    return interaction;
  }

  test("Set reason form: title names the case and target, no DM option without a DM", async () => {
    findById.mockResolvedValueOnce(makeCase({ reason: null, dm: false }));
    const interaction = await submit(makeSubmission("Raid"));

    const modal = (
      interaction.showModal.mock.calls[0] as unknown as [
        {
          title: string;
          custom_id: string;
          components: { component?: { custom_id: string } }[];
        },
      ]
    )[0];
    expect(modal.title).toBe("Reason for #4822 · spambot");
    expect(modal.custom_id).toBe(`/modlog/reason/4822/n/${INTERACTION_ID}`);
    expect(modal.components.map((c) => c.component?.custom_id)).toEqual([
      "reason",
      "save_as_template",
    ]);
  });

  test("Edit reason with a live DM shows the current reason and the DM option", async () => {
    findById.mockResolvedValueOnce(makeCase({ reason: "Old" }));
    const interaction = await submit(makeSubmission("New"));

    const modal = (
      interaction.showModal.mock.calls[0] as unknown as [
        {
          components: {
            type: number;
            content?: string;
            component?: { custom_id: string; options?: { label: string }[] };
          }[];
        },
      ]
    )[0];
    expect(modal.components[0]?.content).toContain("**Current reason**");
    const options = modal.components.at(-1)?.component;
    expect(options?.custom_id).toBe("reason_options");
    expect(options?.options?.map((o) => o.label)).toEqual([
      "Save as template",
      "Also update the DM sent to spambot",
    ]);
  });

  test("too long: nothing changes and Try again reopens the form prefilled", async () => {
    resolve.mockResolvedValueOnce({
      text: "x".repeat(3010),
      template: null,
      unknownShortcut: null,
      source: "shortcut",
      unresolved: null,
    });
    const first = makeSubmission("!long extra");
    await submit(first);

    expect(updateReasons).not.toHaveBeenCalled();
    const reply = JSON.stringify(first.reply.mock.calls[0]);
    expect(reply).toContain("**Nothing was done.**");
    const retryId = /"custom_id":"(modLogReason\/retry\/[^"]+)"/.exec(
      reply,
    )?.[1];
    expect(retryId).toBeDefined();
    expect(handler.customIDMatch(retryId ?? "")).not.toBe(false);

    // Someone else can't use it.
    const stranger = makeButton(retryId ?? "");
    stranger.user = { id: "238381427315195904" };
    await handler.handleInteraction(stranger as unknown as ButtonInteraction);
    expect(stranger.showModal).not.toHaveBeenCalled();

    // The owner reopens the form from the ephemeral error.
    const second = {
      ...makeSubmission("short"),
      deferUpdate: mock(async () => undefined),
      deleteReply: mock(async () => undefined),
    };
    const retry = makeButton(retryId ?? "", second, {
      id: "1",
      embeds: [],
      components: [],
    });
    await handler.handleInteraction(retry as unknown as ButtonInteraction);

    const modal = (
      retry.showModal.mock.calls[0] as unknown as [
        { components: { component?: { custom_id: string; value?: string } }[] },
      ]
    )[0];
    expect(
      modal.components.find((c) => c.component?.custom_id === "reason")
        ?.component?.value,
    ).toBe("!long extra");
    expect(updateReasons).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "short", skipModLogRefreshFor: [] }),
    );
    expect(service.updateFromInteraction).not.toHaveBeenCalled();
    expect(second.deferUpdate).toHaveBeenCalledTimes(1);
    expect(second.deleteReply).toHaveBeenCalledTimes(1);
  });

  test("not opened from the entry: the service refreshes it over REST", async () => {
    const submission = {
      ...makeSubmission("Raid"),
      isFromMessage: () => false,
    };
    await submit(submission);

    expect(updateReasons).toHaveBeenCalledWith(
      expect.objectContaining({ skipModLogRefreshFor: [] }),
    );
    expect(service.updateFromInteraction).not.toHaveBeenCalled();
    expect(submission.reply).toHaveBeenCalledTimes(1);
  });

  test("syncs a legacy deleted DM before offering the DM option", async () => {
    findById.mockResolvedValueOnce(makeCase({ reason: "Old" }));
    service.syncLegacyDeletedDm.mockImplementationOnce(
      async (c: ModerationCase) => c.withDmDeleted(),
    );

    const interaction = await submit(makeSubmission("New"));

    const modal = (
      interaction.showModal.mock.calls[0] as unknown as [
        { components: { component?: { custom_id: string } }[] },
      ]
    )[0];
    expect(modal.components.at(-1)?.component?.custom_id).toBe(
      "save_as_template",
    );
  });

  test("submit saves through updateReasons and updates the entry in place", async () => {
    const submission = makeSubmission("Raid", ["update_dm"]);
    await submit(submission);

    expect(updateReasons).toHaveBeenCalledWith({
      guildId: GUILD,
      executorId: MOD,
      caseRangeStr: "4822",
      reason: "Raid",
      onlyEmpty: false,
      updateDm: true,
      skipModLogRefreshFor: ["4822"],
    });
    expect(service.updateFromInteraction).toHaveBeenCalledWith(
      submission,
      rendered,
    );
    const [renderedCase] = render.mock.calls[0] as unknown as [ModerationCase];
    expect(renderedCase.executorId).toBe(MOD);
    expect(renderedCase.reason?.value).toBe("Raid");
  });

  test("a failed legacy conversion still finishes the form and notes it privately", async () => {
    service.updateFromInteraction.mockResolvedValueOnce("failed");
    const submission = makeSubmission("Raid", ["save"]);

    await submit(submission);

    expect(updateReasons).toHaveBeenCalledTimes(1);
    expect(submission.update).not.toHaveBeenCalled();
    expect(submission.followUp).toHaveBeenCalledWith({
      content: "Saved, but this mod log entry couldn't be updated.",
      flags: MessageFlags.Ephemeral,
    });
    // completeReasonForm still ran: the save-as-template step was reached.
    expect(templateCreate).toHaveBeenCalledTimes(1);
  });

  test("a failed DM update is reported privately", async () => {
    updateReasons.mockResolvedValueOnce(
      Ok({
        updatedCases: [makeCase({ reason: "Raid" })],
        errors: [],
        dmUpdates: [{ caseId: "4822", outcome: "failed" }],
        modLogUpdates: [],
      }),
    );
    const submission = makeSubmission("Raid", ["update_dm"]);

    await submit(submission);

    expect(service.updateFromInteraction).toHaveBeenCalledTimes(1);
    expect(submission.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Couldn't update the DM"),
      }),
    );
  });

  test("an unresolved template pick changes nothing", async () => {
    resolve.mockResolvedValueOnce({
      text: "Recent · Alt account…",
      template: null,
      unknownShortcut: null,
      source: "none",
      unresolved: { kind: "stale_label", input: "Recent · Alt account…" },
    });
    const submission = makeSubmission("Recent · Alt account…");

    await submit(submission);

    expect(updateReasons).not.toHaveBeenCalled();
    expect(JSON.stringify(submission.reply.mock.calls[0])).toContain(
      "old or edited template pick",
    );
  });
});

describe("legacy entry whose REST conversion fails (real ModLogMessageService)", () => {
  const legacyEntry = {
    id: "1029384756102938499",
    channelId: "1029384756102938402",
    flags: { bitfield: 0, has: () => false },
    embeds: [{ fields: [] }],
    components: [],
    toJSON: () => ({ embeds: [{ fields: [] }], components: [] }),
  };

  function realService() {
    const patch = mock(async () => {
      throw new Error("Invalid Form Body");
    });
    const client = {
      user: { id: "1" },
      rest: { patch },
      users: {
        cache: new Map(),
        fetch: mock(async () => ({
          id: TARGET,
          tag: "spambot",
          displayAvatarURL: () => "https://x/a.png",
        })),
      },
    };
    const service = new ModLogMessageService(
      client as never,
      {} as never,
      {
        getEmojis: mock(async (names: readonly string[]) =>
          Object.fromEntries(names.map((n) => [n, ""])),
        ),
      } as never,
      { markDmDeleted: mock(async () => undefined) },
      pino({ level: "silent" }),
    );
    return { service, patch };
  }

  test("button path: acknowledged, entry untouched, mod told privately", async () => {
    const { service, patch } = realService();
    const handler = new ModLogDeleteDMButtonHandler(
      { findById: mock(async () => makeCase({ reason: "Spam" })) },
      { deleteDms: mock(async () => []) },
      service,
      pino({ level: "silent" }),
    );
    const interaction = {
      ...makeButton("modLog/dm/cancel/4822", undefined, legacyEntry),
      deferUpdate: mock(async () => undefined),
      editReply: mock(async () => undefined),
    };

    await handler.handleInteraction(
      interaction as unknown as ButtonInteraction,
    );

    expect(patch).toHaveBeenCalledTimes(1);
    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.update).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: "Couldn't update this mod log entry.",
      flags: MessageFlags.Ephemeral,
    });
  });

  test("modal path: the reason is saved, follow-ups still run", async () => {
    const { service, patch } = realService();
    const templateCreate = mock(async () =>
      Ok({ id: "16", content: "Raid", shortcut: null } as never),
    );
    const updateReasons = mock(async () =>
      Ok({
        updatedCases: [makeCase({ reason: "Raid" })],
        errors: [],
        dmUpdates: [{ caseId: "4822", outcome: "failed" as const }],
        modLogUpdates: [],
      }),
    );
    const handler = new ModLogReasonButtonHandler(
      { findById: mock(async () => makeCase({ reason: "Old" })) },
      { updateReasons },
      {
        getFormData: mock(async () => ({ last: null, templates: [] })),
        resolve: mock(async (_g: string, input: string | null) => ({
          text: input,
          template: null,
          unknownShortcut: null,
          source: "none",
          unresolved: null,
        })),
        recordUse: mock(async () => undefined),
        create: templateCreate,
      } as never,
      service,
      {
        getEmojis: mock(async () => ({
          history: "",
          success: "",
          message_edit: "",
          fail: "",
        })),
      } as never,
      pino({ level: "silent" }),
    );
    const submission = {
      ...makeSubmission("Raid", ["save", "update_dm"]),
      message: legacyEntry,
      deferUpdate: mock(async () => undefined),
      editReply: mock(async () => undefined),
    };

    await handler.handleInteraction(
      makeButton(
        "/modlog/reason/4822",
        submission,
        legacyEntry,
      ) as unknown as ButtonInteraction,
    );

    expect(updateReasons).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(submission.deferUpdate).toHaveBeenCalledTimes(1);
    expect(submission.editReply).not.toHaveBeenCalled();
    expect(submission.update).not.toHaveBeenCalled();
    const notes = JSON.stringify(submission.followUp.mock.calls);
    expect(notes).toContain(
      "Saved, but this mod log entry couldn't be updated.",
    );
    expect(notes).toContain("Couldn't update the DM.");
    expect(templateCreate).toHaveBeenCalledTimes(1);
  });
});
