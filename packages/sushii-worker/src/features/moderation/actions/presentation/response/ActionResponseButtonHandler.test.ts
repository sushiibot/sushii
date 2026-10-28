import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { APIContainerComponent, ButtonInteraction } from "discord.js";
import { ComponentType, DiscordjsError, DiscordjsErrorCodes } from "discord.js";
import pino from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { ReasonUpdateResult } from "@/features/moderation/cases/application/ReasonUpdateService";
import type { ExpandResult } from "@/features/moderation/reason-templates/domain/ReasonExpander";
import type { CaseDmDeletionOutcome } from "@/features/moderation/shared/application/CaseDmDeletionService";
import { BanAction } from "@/features/moderation/shared/domain/entities/ModerationAction";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { Reason } from "@/features/moderation/shared/domain/value-objects/Reason";
import {
  REASON_FIELD_IDS,
  REASON_OPTION_VALUES,
} from "@/features/moderation/shared/presentation/reasonFields";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import { UNRESOLVED_TEMPLATE_MESSAGE } from "../components/reasonFormSubmit";
import {
  ACTION_RESPONSE_IDS,
  EXPIRED_LINE,
  buildActionResultMessage,
  expireActionResponse,
} from "../views/ModerationActionView";
import {
  ActionResponseButtonHandler,
  formTimeoutMs,
} from "./ActionResponseButtonHandler";
import {
  GUILD,
  MOD,
  TARGET,
  TARGET_2,
  makeAllEmojis,
  makeCase,
  makeEmojis,
  makeTarget,
  makeUser,
} from "./testFixtures";

const DiscordjsErrorCtor = DiscordjsError as unknown as new (
  code: DiscordjsErrorCodes,
  ...args: unknown[]
) => DiscordjsError;

const NOW = Date.parse("2026-10-27T11:05:00.000Z");
const CREATED = Date.parse("2026-10-27T11:00:00.000Z");

function postedMessage(cases: ModerationCase[], savePrompt = false) {
  const message = buildActionResultMessage({
    actionType: ActionType.Ban,
    executor: makeUser(MOD, "tzuyu"),
    targets: cases.map((c) => makeTarget(c.userId, c.userTag)),
    results: cases.map((c) => Ok(c)),
    guildConfig: GuildConfig.createDefault(GUILD),
    action: new BanAction(
      GUILD,
      makeUser(MOD, "tzuyu"),
      null,
      Reason.create("Spamming invite links").unwrap(),
      "unspecified",
    ),
    emojis: makeEmojis(),
    savePrompt,
  });
  return {
    createdTimestamp: CREATED,
    components: message.components.map((c) => {
      const json = c.toJSON();
      return { toJSON: () => json };
    }),
    edit: mock(async (_o: unknown) => undefined),
  };
}

/** The message as Discord would show it after a rendered update. */
function postedFrom(
  mockFn: ReturnType<typeof mock>,
  createdTimestamp = CREATED,
): ReturnType<typeof postedMessage> {
  const [options] = mockFn.mock.calls.at(-1) as [Options];
  return {
    createdTimestamp,
    components: options.components.map((c) => {
      const json = c.toJSON() as APIContainerComponent;
      return { toJSON: () => json };
    }),
    edit: mock(async (_o: unknown) => undefined),
  };
}

type Options = { components: { toJSON(): unknown }[] } & Record<
  string,
  unknown
>;

function rendered(mockFn: ReturnType<typeof mock>, call = 0): string {
  const [options] = mockFn.mock.calls[call] as [Options];
  return JSON.stringify(options.components.map((c) => c.toJSON()));
}

/** A rendered component by id, at any depth. */
function renderedById(
  mockFn: ReturnType<typeof mock>,
  id: number,
  call = 0,
): { type: number; content?: string; accessory?: unknown } | null {
  let found = null;
  const visit = (node: unknown): void => {
    const c = node as {
      id?: number;
      type: number;
      components?: unknown[];
    };
    if (c.id === id) {
      found = c;
    }
    (c.components ?? []).forEach(visit);
  };
  (JSON.parse(rendered(mockFn, call)) as unknown[]).forEach(visit);
  return found;
}

function makeFields(values: { text?: string; options?: string[] }) {
  const fields = new Map<string, unknown>();
  fields.set(REASON_FIELD_IDS.text, { value: values.text ?? "" });
  fields.set(REASON_FIELD_IDS.options, { values: values.options ?? [] });
  return {
    fields,
    getTextInputValue: () => values.text ?? "",
    getStringSelectValues: () => [],
    getCheckbox: () => false,
    getCheckboxGroup: () => values.options ?? [],
  };
}

function makeSubmission(
  message: ReturnType<typeof postedMessage>,
  values: { text?: string; options?: string[] },
) {
  return {
    id: "1558174981962080001",
    guildId: GUILD,
    user: { id: MOD },
    memberPermissions: { any: () => true },
    message,
    fields: makeFields(values),
    inCachedGuild: () => true,
    isFromMessage: () => true,
    reply: mock(async (_o: unknown) => undefined),
    update: mock(async (_o: unknown) => undefined),
    deferUpdate: mock(async () => undefined),
    editReply: mock(async (_o: unknown) => undefined),
    deleteReply: mock(async () => undefined),
    followUp: mock(async (_o: unknown) => undefined),
  };
}

function makeButton(
  customId: string,
  message: ReturnType<typeof postedMessage>,
  options: { submission?: unknown; allowed?: boolean } = {},
) {
  return {
    id: "1558174981962080000",
    customId,
    guildId: GUILD,
    user: { id: MOD },
    message,
    memberPermissions: { any: () => options.allowed ?? true },
    inCachedGuild: () => true,
    guild: { members: { cache: new Map() } },
    client: { users: { cache: new Map() } },
    reply: mock(async (_o: unknown) => undefined),
    update: mock(async (_o: unknown) => undefined),
    deferUpdate: mock(async () => undefined),
    editReply: mock(async (_o: unknown) => undefined),
    followUp: mock(async (_o: unknown) => undefined),
    showModal: mock(async (_m: unknown) => undefined),
    awaitModalSubmit: mock(async () => {
      if (!options.submission) {
        throw new DiscordjsErrorCtor(
          DiscordjsErrorCodes.InteractionCollectorError,
          "time",
        );
      }
      return options.submission;
    }),
  };
}

function updateResult(
  cases: ModerationCase[],
  dm?: "updated" | "failed",
): Result<ReasonUpdateResult, string> {
  return Ok({
    updatedCases: cases,
    errors: [],
    dmUpdates: dm ? cases.map((c) => ({ caseId: c.caseId, outcome: dm })) : [],
    modLogUpdates: cases.map((c) => ({
      caseId: c.caseId,
      outcome: "updated" as const,
    })),
  });
}

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

describe("ActionResponseButtonHandler", () => {
  let findByIds: ReturnType<typeof mock>;
  let updateReasons: ReturnType<typeof mock>;
  let deleteDms: ReturnType<typeof mock>;
  let resolve: ReturnType<typeof mock>;
  let create: ReturnType<typeof mock>;
  let recordUse: ReturnType<typeof mock>;
  let shouldPromptSave: ReturnType<typeof mock>;
  let metrics: {
    recordReasonResolved: ReturnType<typeof mock>;
    recordSavePrompt: ReturnType<typeof mock>;
    recordActionResponseButton: ReturnType<typeof mock>;
  };
  let handler: ActionResponseButtonHandler;
  let now: number;

  beforeEach(() => {
    now = NOW;
    findByIds = mock(async (_g: string, ids: string[]) =>
      ids.map((id, i) =>
        makeCase({ caseId: id, userId: i ? TARGET_2 : TARGET }),
      ),
    );
    updateReasons = mock(async (o: { caseRangeStr: string; reason: string }) =>
      updateResult(
        o.caseRangeStr.split("-").map((id) =>
          makeCase({
            caseId: id,
            reason: o.reason,
            reasonSetBy: MOD,
            reasonSetAt: new Date(NOW),
          }),
        ),
      ),
    );
    deleteDms = mock(
      async (_g: string, ids: string[]): Promise<CaseDmDeletionOutcome[]> =>
        ids.map((caseId) => ({
          caseId,
          result: "deleted",
          moderationCase: makeCase({ caseId, dmDeleted: true }),
          modLog: "updated",
        })),
    );
    resolve = mock(async (_g: string, input: string) => expand(input));
    create = mock(async () => Ok({ id: "16", shortcut: null, content: "x" }));
    recordUse = mock(async () => undefined);
    shouldPromptSave = mock(async () => false);
    metrics = {
      recordReasonResolved: mock(),
      recordSavePrompt: mock(),
      recordActionResponseButton: mock(),
    };

    handler = new ActionResponseButtonHandler({
      modLogRepository: { findByIds },
      reasonUpdateService: { updateReasons },
      caseDmDeletionService: { deleteDms },
      reasonTemplateService: {
        getFormData: mock(async () => ({ last: null, templates: [] })),
        resolve,
        recordUse,
        create,
        shouldPromptSave,
      } as never,
      emojiRepository: {
        getEmojis: mock(async () => makeAllEmojis()),
      } as never,
      metrics,
      logger: pino({ level: "silent" }),
      now: () => now,
    });
  });

  function expectButtonMetric(...calls: [string, string][]) {
    expect(metrics.recordActionResponseButton.mock.calls).toEqual(calls);
  }

  async function click(button: ReturnType<typeof makeButton>) {
    await handler.handleInteraction(button as unknown as ButtonInteraction);
    return button;
  }

  test("refuses non-mods", async () => {
    const button = await click(
      makeButton("modAction/reason/edit/4822", postedMessage([makeCase()]), {
        allowed: false,
      }),
    );

    expect(button.reply).toHaveBeenCalledTimes(1);
    expect(findByIds).not.toHaveBeenCalled();
    expect(button.showModal).not.toHaveBeenCalled();
    expectButtonMetric(["edit_reason", "denied"]);
  });

  test("after 15 minutes strips the buttons and tells the clicker", async () => {
    now = CREATED + 16 * 60 * 1000;
    const button = await click(
      makeButton("modAction/reason/edit/4822", postedMessage([makeCase()])),
    );

    expect(rendered(button.update)).toContain(
      "Buttons expired after 15 minutes",
    );
    expect(rendered(button.update)).not.toContain("modAction/");
    expect(renderedById(button.update, ACTION_RESPONSE_IDS.reason)?.type).toBe(
      ComponentType.TextDisplay,
    );
    expect(JSON.stringify(button.followUp.mock.calls[0])).toContain(
      "These buttons expired",
    );
    expect(findByIds).not.toHaveBeenCalled();
    expectButtonMetric(["edit_reason", "expired"]);
  });

  describe("Edit reason", () => {
    async function submit(
      values: { text?: string; options?: string[] },
      caseIds = "4822",
      cases = [makeCase()],
    ) {
      const message = postedMessage(cases);
      const submission = makeSubmission(message, values);
      const button = await click(
        makeButton(`modAction/reason/edit/${caseIds}`, message, { submission }),
      );
      return { button, submission };
    }

    test("opens a form for the reloaded cases with the DM option", async () => {
      const { button } = await submit({ text: "" });
      const [modal] = button.showModal.mock.calls[0] as [unknown];
      const json = JSON.stringify(modal);
      expect(json).toContain("Current reason");
      expect(json).toContain("Also update the DM sent to spambot");
      expect(json).toContain("modAction/reasonForm/");
    });

    test("an empty submit changes nothing", async () => {
      const { submission } = await submit({ text: "" });
      expect(updateReasons).not.toHaveBeenCalled();
      expect(JSON.stringify(submission.reply.mock.calls[0])).toContain(
        "Nothing changed",
      );
    });

    test("an unresolved template pick is refused", async () => {
      resolve.mockImplementation(async (_g: string, input: string) =>
        expand(input, { unresolved: { kind: "stale_label", input } }),
      );
      const { submission } = await submit({ text: "!spam · Spamming" });
      expect(updateReasons).not.toHaveBeenCalled();
      expect(JSON.stringify(submission.reply.mock.calls[0])).toContain(
        UNRESOLVED_TEMPLATE_MESSAGE,
      );
    });

    test("too long after expanding is refused", async () => {
      resolve.mockImplementation(async () => expand("y".repeat(3001)));
      const { submission } = await submit({ text: "!long" });
      expect(updateReasons).not.toHaveBeenCalled();
      expect(metrics.recordReasonResolved).toHaveBeenCalledWith(
        "edit",
        "too_long",
      );
      expect(JSON.stringify(submission.reply.mock.calls[0])).toContain(
        "Nothing was done",
      );
    });

    test("updates without touching the DM", async () => {
      const { submission } = await submit({ text: "Raid" });

      expect(metrics.recordReasonResolved).toHaveBeenCalledWith(
        "edit",
        "typed",
      );
      expectButtonMetric(["edit_reason", "ok"]);

      expect(updateReasons).toHaveBeenCalledWith(
        expect.objectContaining({
          caseRangeStr: "4822",
          reason: "Raid",
          onlyEmpty: false,
          updateDm: false,
        }),
      );
      expect(submission.deferUpdate).not.toHaveBeenCalled();
      const json = rendered(submission.update);
      expect(json).toContain("Raid");
      expect(json).toContain(`Edited by <@${MOD}>`);
      expect(json).toContain("mod log updated");
      expect(json).toContain(
        "DM not updated: the user still sees the original reason",
      );
      expect(
        renderedById(submission.update, ACTION_RESPONSE_IDS.dm)?.content,
      ).toBe("**DM sent** · what they received:\n> Spamming invite links");
    });

    test("a save prompt that appears after the edit is counted as shown", async () => {
      shouldPromptSave.mockImplementation(async () => true);
      const { submission } = await submit({ text: "Raid" });

      expect(rendered(submission.update)).toContain("modAction/save/");
      expect(metrics.recordSavePrompt.mock.calls).toEqual([["shown"]]);
    });

    test("a save prompt the response already had isn't counted again", async () => {
      shouldPromptSave.mockImplementation(async () => true);
      const message = postedMessage([makeCase()], true);
      const submission = makeSubmission(message, { text: "Raid" });
      await click(
        makeButton("modAction/reason/edit/4822", message, { submission }),
      );

      expect(rendered(submission.update)).toContain("modAction/save/");
      expect(metrics.recordSavePrompt).not.toHaveBeenCalled();
    });

    test("updates the DM when ticked", async () => {
      updateReasons.mockImplementation(
        async (o: { caseRangeStr: string; reason: string }) =>
          updateResult(
            [makeCase({ caseId: o.caseRangeStr, reason: o.reason })],
            "updated",
          ),
      );
      const { submission } = await submit({
        text: "Raid",
        options: [REASON_OPTION_VALUES.updateDm],
      });

      expect(updateReasons).toHaveBeenCalledWith(
        expect.objectContaining({ updateDm: true }),
      );
      expect(rendered(submission.update)).toContain(
        "DM updated with the new reason",
      );
      expect(
        renderedById(submission.update, ACTION_RESPONSE_IDS.dm)?.content,
      ).toBe("**DM sent** · what they received:\n> Raid");
    });

    test("several cases defer, update per run and never touch cases in between", async () => {
      findByIds.mockImplementation(async (_g: string, ids: string[]) =>
        ids.map((id) => makeCase({ caseId: id })),
      );
      const cases = [
        makeCase({ caseId: "4822" }),
        makeCase({ caseId: "4823", userId: TARGET_2 }),
      ];
      const { submission } = await submit({ text: "Raid" }, "4822,4830", cases);

      expect(
        updateReasons.mock.calls.map(
          ([o]) => (o as { caseRangeStr: string }).caseRangeStr,
        ),
      ).toEqual(["4822", "4830"]);
      expect(submission.deferUpdate).toHaveBeenCalledTimes(1);
      expect(submission.update).not.toHaveBeenCalled();
      expect(submission.editReply).toHaveBeenCalledTimes(1);
    });

    test("an error after deferring is reported privately, not to the router", async () => {
      updateReasons.mockImplementation(async () => {
        throw new Error("db down");
      });
      const { submission } = await submit({ text: "Raid" }, "4822-4823", [
        makeCase({ caseId: "4822" }),
        makeCase({ caseId: "4823", userId: TARGET_2 }),
      ]);

      expect(submission.editReply).not.toHaveBeenCalled();
      expect(JSON.stringify(submission.followUp.mock.calls[0])).toContain(
        "Couldn't finish",
      );
    });

    test("a template save conflict is a note, not a failure", async () => {
      create.mockImplementation(async () =>
        Err({ code: "duplicate", existing: { shortcut: "spam" } }),
      );
      const { submission } = await submit({
        text: "Raid",
        options: [REASON_OPTION_VALUES.save],
      });

      expect(submission.update).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(submission.followUp.mock.calls.at(-1))).toContain(
        "Not saved as a template",
      );
    });

    test("a ticked save that works sends the saved confirmation", async () => {
      const { submission } = await submit({
        text: "Raid",
        options: [REASON_OPTION_VALUES.save],
      });

      expect(create).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(submission.followUp.mock.calls.at(-1))).toContain(
        "Template saved",
      );
      // Saved already, so no Save as template button.
      expect(shouldPromptSave).not.toHaveBeenCalled();
    });
  });

  describe("Delete DM", () => {
    test("asks in place first", async () => {
      const button = await click(
        makeButton("modAction/dm/delete/4822", postedMessage([makeCase()])),
      );

      const json = rendered(button.update);
      expect(json).toContain("modAction/dm/deleteConfirm/4822");
      expect(json).toContain("modAction/dm/cancel/4822");
      expect(json).not.toContain("modAction/dm/delete/4822");
      expect(
        renderedById(button.update, ACTION_RESPONSE_IDS.dmSection),
      ).toBeNull();
      expect(
        renderedById(button.update, ACTION_RESPONSE_IDS.dm)?.content,
      ).toStartWith("**DM sent**");
      expect(
        renderedById(button.update, ACTION_RESPONSE_IDS.reasonSection)
          ?.accessory,
      ).toMatchObject({ custom_id: "modAction/reason/edit/4822" });
      expect(deleteDms).not.toHaveBeenCalled();
      expectButtonMetric();
    });

    test("Cancel restores the buttons", async () => {
      const button = await click(
        makeButton("modAction/dm/cancel/4822", postedMessage([makeCase()])),
      );

      const json = rendered(button.update);
      expect(json).toContain("modAction/dm/delete/4822");
      expect(json).not.toContain("deleteConfirm");
      expectButtonMetric(["delete_dm", "dismissed"]);
    });

    test("confirm deletes, then shows who deleted it", async () => {
      const button = await click(
        makeButton(
          "modAction/dm/deleteConfirm/4822",
          postedMessage([makeCase()]),
        ),
      );

      expect(deleteDms).toHaveBeenCalledWith(GUILD, ["4822"], MOD);
      expect(button.deferUpdate).not.toHaveBeenCalled();
      const json = rendered(button.update);
      expect(json).toContain("**DM deleted** by");
      expect(json).toContain("mod log updated");
      expect(json).not.toContain("modAction/dm/delete/");
      expectButtonMetric(["delete_dm", "ok"]);
    });

    test("several DMs defer and keep errors away from the router", async () => {
      deleteDms.mockImplementation(async () => {
        throw new Error("rest down");
      });
      const cases = [
        makeCase({ caseId: "4822" }),
        makeCase({ caseId: "4823", userId: TARGET_2 }),
      ];
      const button = await click(
        makeButton(
          "modAction/dm/deleteConfirm/4822-4823",
          postedMessage(cases),
        ),
      );

      expect(button.deferUpdate).toHaveBeenCalledTimes(1);
      expect(button.editReply).not.toHaveBeenCalled();
      expect(button.followUp).toHaveBeenCalledTimes(1);
      expectButtonMetric(["delete_dm", "failed"]);
    });
  });

  describe("Save as template", () => {
    test("removes the button after saving", async () => {
      const message = postedMessage([makeCase()], true);
      const submit = {
        guildId: GUILD,
        user: { id: MOD },
        memberPermissions: { any: () => true },
        fields: {
          getTextInputValue: (id: string) =>
            id === "content" ? "Spamming invite links" : "",
        },
        isFromMessage: () => true,
        update: mock(async (_o: unknown) => undefined),
        reply: mock(async (_o: unknown) => undefined),
        followUp: mock(async (_o: unknown) => undefined),
      };
      const button = await click(
        makeButton("modAction/save/4822", message, { submission: submit }),
      );

      expect(button.showModal).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledTimes(1);
      const json = rendered(submit.update);
      expect(json).not.toContain("modAction/save/");
      expect(json).toContain("modAction/reason/edit/4822");
      expect(JSON.stringify(submit.followUp.mock.calls[0])).toContain(
        "Template saved",
      );
      expect(metrics.recordSavePrompt).toHaveBeenCalledWith("clicked");
      expectButtonMetric(["save_template", "ok"]);
    });

    test("a dismissed form answers nothing", async () => {
      const button = await click(
        makeButton("modAction/save/4822", postedMessage([makeCase()], true)),
      );

      expect(button.reply).not.toHaveBeenCalled();
      expect(button.update).not.toHaveBeenCalled();
      expect(button.followUp).not.toHaveBeenCalled();
      expectButtonMetric(["save_template", "dismissed"]);
    });
  });

  test("a submit after the window renders the expired state", async () => {
    const message = postedMessage([makeCase()]);
    const submission = makeSubmission(message, { text: "Raid" });
    const button = makeButton("modAction/reason/edit/4822", message, {
      submission,
    });
    button.awaitModalSubmit.mockImplementation(async () => {
      now = CREATED + 16 * 60 * 1000;
      return submission;
    });
    await click(button);

    const json = rendered(submission.update);
    expect(json).toContain(JSON.stringify(EXPIRED_LINE).slice(1, -1));
    expect(json).not.toContain("modAction/");
  });

  test("Delete DM then Cancel keeps Save as template", async () => {
    shouldPromptSave.mockImplementation(async () => true);
    const first = await click(
      makeButton("modAction/dm/delete/4822", postedMessage([makeCase()], true)),
    );
    expect(rendered(first.update)).toContain("deleteConfirm");

    const cancel = await click(
      makeButton("modAction/dm/cancel/4822", postedFrom(first.update)),
    );
    const json = rendered(cancel.update);
    expect(json).toContain("modAction/save/4822");
    expect(json).toContain("modAction/dm/delete/4822");
  });

  test("a DM deleted while the form was open shows as deleted", async () => {
    updateReasons.mockImplementation(
      async (o: { caseRangeStr: string; reason: string }) =>
        Ok({
          updatedCases: [
            makeCase({
              caseId: o.caseRangeStr,
              reason: o.reason,
              dmDeleted: true,
            }),
          ],
          errors: [],
          dmUpdates: [{ caseId: o.caseRangeStr, outcome: "no_dm" as const }],
          modLogUpdates: [
            { caseId: o.caseRangeStr, outcome: "updated" as const },
          ],
        }),
    );
    const message = postedMessage([makeCase()]);
    const submission = makeSubmission(message, {
      text: "Raid",
      options: [REASON_OPTION_VALUES.updateDm],
    });
    await click(
      makeButton("modAction/reason/edit/4822", message, { submission }),
    );

    const json = rendered(submission.update);
    expect(json).toContain("**DM deleted** by");
    expect(json).not.toContain("still sees the original reason");
  });

  test("a failing template save after the edit is a note, never an error", async () => {
    create.mockImplementation(async () => {
      throw new Error("db down");
    });
    const message = postedMessage([makeCase()]);
    const submission = makeSubmission(message, {
      text: "Raid",
      options: [REASON_OPTION_VALUES.save],
    });
    await click(
      makeButton("modAction/reason/edit/4822", message, { submission }),
    );

    expect(submission.update).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(submission.followUp.mock.calls.at(-1))).toContain(
      "Reason updated, but a follow-up step failed.",
    );
  });

  test("an unknown shortcut note only says DMed when the DM was edited", async () => {
    resolve.mockImplementation(async (_g: string, input: string) =>
      expand(input, { unknownShortcut: "spma" }),
    );
    const message = postedMessage([makeCase()]);
    const submission = makeSubmission(message, { text: "!spma" });
    await click(
      makeButton("modAction/reason/edit/4822", message, { submission }),
    );

    const json = rendered(submission.update);
    expect(json).toContain("No template `!spma`");
    expect(json).not.toContain("DMed like that");
  });

  test("Save as template renders from the submit's message, expired by then", async () => {
    const clicked = postedMessage([makeCase()], true);
    const expired = expireActionResponse(
      clicked.components.map((c) => c.toJSON()) as never,
    );
    const atSubmit = {
      createdTimestamp: CREATED,
      components: (expired?.components ?? []).map((c) => {
        const json = c.toJSON();
        return { toJSON: () => json };
      }),
    };
    const submit = {
      guildId: GUILD,
      user: { id: MOD },
      memberPermissions: { any: () => true },
      message: atSubmit,
      fields: {
        getTextInputValue: (id: string) =>
          id === "content" ? "Spamming invite links" : "",
      },
      isFromMessage: () => true,
      update: mock(async (_o: unknown) => undefined),
      reply: mock(async (_o: unknown) => undefined),
      followUp: mock(async (_o: unknown) => undefined),
    };
    await click(
      makeButton("modAction/save/4822", clicked, { submission: submit }),
    );

    const json = rendered(submit.update);
    expect(json).toContain(JSON.stringify(EXPIRED_LINE).slice(1, -1));
    expect(json).not.toContain("modAction/");
  });

  test("too long offers Try again, which reopens the form and edits the response", async () => {
    resolve.mockImplementation(async () => expand("y".repeat(3001)));
    const message = postedMessage([makeCase()]);
    const tooLong = makeSubmission(message, { text: "!long" });
    await click(
      makeButton("modAction/reason/edit/4822", message, {
        submission: tooLong,
      }),
    );
    const retryId = /modAction\/reasonRetry\/[A-Za-z0-9_-]+/.exec(
      JSON.stringify(tooLong.reply.mock.calls[0]),
    )?.[0];
    expect(retryId).toBeDefined();
    expect(handler.customIDMatch(retryId ?? "")).not.toBe(false);

    resolve.mockImplementation(async (_g: string, input: string) =>
      expand(input),
    );
    const errorMessage = postedMessage([]);
    const retrySubmit = {
      ...makeSubmission(errorMessage, { text: "Raid" }),
    };
    const retry = await click(
      makeButton(retryId ?? "", errorMessage, { submission: retrySubmit }),
    );

    const [modal] = retry.showModal.mock.calls[0] as [unknown];
    expect(JSON.stringify(modal)).toContain('"value":"!long"');
    expect(retrySubmit.deferUpdate).toHaveBeenCalledTimes(1);
    expect(rendered(message.edit)).toContain("Raid");
    expect(retrySubmit.deleteReply).toHaveBeenCalledTimes(1);
    expect(retrySubmit.update).not.toHaveBeenCalled();
  });

  test("a failed refresh after Try again is only a note", async () => {
    resolve.mockImplementation(async () => expand("y".repeat(3001)));
    const message = postedMessage([makeCase()]);
    const tooLong = makeSubmission(message, { text: "!long" });
    await click(
      makeButton("modAction/reason/edit/4822", message, {
        submission: tooLong,
      }),
    );
    const retryId = /modAction\/reasonRetry\/[A-Za-z0-9_-]+/.exec(
      JSON.stringify(tooLong.reply.mock.calls[0]),
    )?.[0];

    resolve.mockImplementation(async (_g: string, input: string) =>
      expand(input),
    );
    message.edit.mockRejectedValueOnce(new Error("Missing Access"));
    const errorMessage = postedMessage([]);
    const retrySubmit = makeSubmission(errorMessage, { text: "Raid" });
    retrySubmit.deleteReply.mockRejectedValueOnce(new Error("Unknown Message"));

    await click(
      makeButton(retryId ?? "", errorMessage, { submission: retrySubmit }),
    );

    expect(retrySubmit.editReply).not.toHaveBeenCalled();
    expect(JSON.stringify(retrySubmit.followUp.mock.calls)).toContain(
      "this response couldn't be refreshed",
    );
  });

  test("the form stays open for the rest of the window, at least five minutes", () => {
    expect(formTimeoutMs(CREATED, CREATED + 5 * 60 * 1000)).toBe(
      10 * 60 * 1000,
    );
    expect(formTimeoutMs(CREATED, CREATED + 14.9 * 60 * 1000)).toBe(
      5 * 60 * 1000,
    );
  });
});
