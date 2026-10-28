import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ButtonInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import pino from "pino";
import { Err, Ok } from "ts-results";

import {
  BanAction,
  type ModerationAction,
} from "@/features/moderation/shared/domain/entities/ModerationAction";

import { AutomodAlertActionButtonHandler } from "./AutomodAlertActionButtonHandler";
import type { ActionReasonFormDeps } from "./reasonFormSubmit";

const GUILD = "187450744427773963";
const USER = "912345678901234567";
const MOD = "150443906511667200";
const ALERT_CHANNEL = "1029384756102938400";
const ALERT = "1029384756102938499";

const TEMPLATE = {
  id: "11",
  guildId: GUILD,
  shortcut: "spam",
  content: "Spamming in channels (rule 3).",
  contentKey: "k",
  createdBy: MOD,
  createdAt: new Date(),
  updatedAt: null,
  useCount: 3,
  lastUsedAt: null,
};

function alertMessage() {
  const container = {
    type: 17,
    components: [
      { type: 10, content: "AutoMod alert · spambot" },
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 4,
            label: "Ban",
            custom_id: `/automod/alert/action/ban/${USER}`,
          },
        ],
      },
    ],
  };
  return {
    id: ALERT,
    toJSON: () => ({ components: [container] }),
    edit: mock(async () => undefined),
  };
}

function makeSubmission(
  opts: { reason?: string; template?: string; save?: boolean } = {},
) {
  const fields = new Map<string, unknown>([
    ["reason", { customId: "reason", value: opts.reason ?? "" }],
    ["save_as_template", { customId: "save_as_template", value: !!opts.save }],
  ]);
  if (opts.template) {
    fields.set("reason_template", {
      customId: "reason_template",
      values: [opts.template],
    });
  }
  return {
    fields: {
      fields,
      getTextInputValue: () => opts.reason ?? "",
      getCheckbox: () => !!opts.save,
      getCheckboxGroup: () => [],
      getStringSelectValues: (id: string) => {
        if (id === "reason_template" && opts.template) {
          return [opts.template];
        }
        throw new Error(`missing ${id}`);
      },
    },
    guildId: GUILD,
    user: { id: MOD },
    message: alertMessage(),
    inCachedGuild: () => true,
    isFromMessage: () => true,
    reply: mock(async () => undefined),
    deferUpdate: mock(async () => undefined),
    deleteReply: mock(async () => undefined),
    followUp: mock(async () => undefined),
    editReply: mock(async () => undefined),
  };
}

const alertForRetry = alertMessage();

function makeInteraction(
  customId: string,
  submission: ReturnType<typeof makeSubmission>,
  userId = MOD,
) {
  return {
    id: "1558174981962080000",
    customId,
    guildId: GUILD,
    channelId: ALERT_CHANNEL,
    user: { id: userId, toString: () => `<@${userId}>` },
    member: { id: userId },
    message: { id: ALERT },
    memberPermissions: { any: () => true },
    inCachedGuild: () => true,
    reply: mock(async () => undefined),
    showModal: mock(async () => undefined),
    awaitModalSubmit: mock(async () => submission),
    guild: {
      members: {
        cache: new Map([[USER, { displayName: "spambot" }]]),
        fetch: mock(async () => ({
          id: USER,
          user: { id: USER, toString: () => `<@${USER}>` },
        })),
      },
    },
    client: {
      users: { cache: new Map(), fetch: mock(async () => ({ id: USER })) },
      channels: {
        fetch: mock(async () => ({
          isTextBased: () => true,
          messages: { fetch: mock(async () => alertForRetry) },
        })),
      },
    },
  };
}

describe("AutomodAlertActionButtonHandler", () => {
  let executeAction: ReturnType<typeof mock>;
  let formDeps: {
    reasonTemplateService: Record<string, ReturnType<typeof mock>>;
    emojiRepository: { getEmojis: ReturnType<typeof mock> };
    logger: pino.Logger;
  };
  let handler: AutomodAlertActionButtonHandler;

  beforeEach(() => {
    executeAction = mock(async () => [Ok({ caseId: "4822" })]);
    formDeps = {
      reasonTemplateService: {
        getFormData: mock(async () => ({ last: null, templates: [TEMPLATE] })),
        resolve: mock(async (_g: string, input: string | null) =>
          input
            ? {
                text: input,
                template: null,
                unknownShortcut: null,
                source: "none",
                unresolved: null,
              }
            : null,
        ),
        recordUse: mock(async () => undefined),
        create: mock(async () => Ok(TEMPLATE)),
      },
      emojiRepository: {
        getEmojis: mock(async () => ({
          history: "",
          success: "",
          message_edit: "",
          fail: "",
        })),
      },
      logger: pino({ level: "silent" }),
    };
    handler = new AutomodAlertActionButtonHandler(
      { executeAction },
      formDeps as unknown as ActionReasonFormDeps,
      pino({ level: "silent" }),
    );
  });

  async function run(interaction: ReturnType<typeof makeInteraction>) {
    await handler.handleInteraction(
      interaction as unknown as ButtonInteraction,
    );
  }

  function executedAction(): ModerationAction {
    return (executeAction.mock.calls[0] as unknown as [ModerationAction])[0];
  }

  test("bans with the picked template and appends the result to the alert", async () => {
    const submission = makeSubmission({ template: "template:11" });
    const interaction = makeInteraction(
      `/automod/alert/action/ban/${USER}`,
      submission,
    );

    await run(interaction);

    const modal = (
      interaction.showModal.mock.calls[0] as unknown as [{ title: string }]
    )[0];
    expect(modal.title).toBe("Ban spambot");
    expect(executedAction()).toBeInstanceOf(BanAction);
    expect(executedAction().reason?.value).toBe(TEMPLATE.content);
    expect(formDeps.reasonTemplateService.recordUse).toHaveBeenCalledWith(
      GUILD,
      "11",
    );
    const [payload] = submission.editReply.mock.calls[0] as unknown as [
      { components: { components: { content?: string }[] }[]; flags: number },
    ];
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(JSON.stringify(payload.components)).toContain("(case #4822)");
  });

  test("the save note goes out even when the alert edit fails", async () => {
    formDeps.reasonTemplateService.create.mockResolvedValueOnce(
      Err({ code: "limit_reached", limit: 100 }),
    );
    const submission = makeSubmission({ reason: "Spam", save: true });
    submission.editReply.mockRejectedValueOnce(new Error("Unknown Message"));

    await run(makeInteraction(`/automod/alert/action/ban/${USER}`, submission));

    expect(executeAction).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(submission.followUp.mock.calls)).toContain(
      "100 templates, the maximum",
    );
  });

  test("a failed action replies and leaves the alert", async () => {
    executeAction.mockResolvedValueOnce([Err("Missing permissions")]);
    const submission = makeSubmission({ reason: "Spam" });

    await run(makeInteraction(`/automod/alert/action/ban/${USER}`, submission));

    expect(submission.editReply).not.toHaveBeenCalled();
    expect(JSON.stringify(submission.followUp.mock.calls[0])).toContain(
      "Action failed: Missing permissions",
    );
  });

  test("too long: Try again reopens prefilled and edits the alert over REST", async () => {
    const first = makeSubmission({
      template: "template:11",
      reason: "x".repeat(2990),
    });
    await run(makeInteraction(`/automod/alert/action/ban/${USER}`, first));

    expect(executeAction).not.toHaveBeenCalled();
    const reply = JSON.stringify(first.reply.mock.calls[0]);
    const retryId = /"custom_id":"(automodAlert\/retry\/[^"]+)"/.exec(
      reply,
    )?.[1];
    expect(retryId).toBeDefined();

    const stranger = makeInteraction(
      retryId ?? "",
      makeSubmission(),
      "238381427315195904",
    );
    await run(stranger);
    expect(stranger.showModal).not.toHaveBeenCalled();
    expect(JSON.stringify(stranger.reply.mock.calls[0])).toContain(
      "belongs to someone else",
    );

    const second = makeSubmission({ reason: "short" });
    const retry = makeInteraction(retryId ?? "", second);
    Object.assign(second, { client: retry.client });
    await run(retry);

    const modal = (
      retry.showModal.mock.calls[0] as unknown as [
        { components: { component: { custom_id: string; value?: string } }[] },
      ]
    )[0];
    expect(
      modal.components.find((c) => c.component.custom_id === "reason")
        ?.component.value,
    ).toBe("x".repeat(2990));
    expect(executedAction().reason?.value).toBe("short");
    expect(alertForRetry.edit).toHaveBeenCalledTimes(1);
    expect(second.deleteReply).toHaveBeenCalledTimes(1);
    expect(second.editReply).not.toHaveBeenCalled();
  });
});
