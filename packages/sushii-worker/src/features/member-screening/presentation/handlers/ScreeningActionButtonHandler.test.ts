import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import type { ButtonInteraction } from "discord.js";
import {
  ContainerBuilder,
  DiscordAPIError,
  MessageFlags,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
} from "discord.js";
import pino from "pino";
import { Err, Ok } from "ts-results";

import type { ModerationService } from "@/features/moderation/actions/application/ModerationService";
import type { ActionReasonFormDeps } from "@/features/moderation/actions/presentation/components/reasonFormSubmit";
import {
  BanAction,
  type ModerationAction,
  TimeoutAction,
  UnbanAction,
} from "@/features/moderation/shared/domain/entities/ModerationAction";
import type { ModerationTarget } from "@/features/moderation/shared/domain/entities/ModerationTarget";

import type { ScreeningMetrics } from "../../domain/ScreeningMetrics";
import type { ScreeningVerdictRepository } from "../../domain/repositories/ScreeningVerdictRepository";
import type { ScreeningVerdict } from "../../domain/types";
import { ScreeningActionButtonHandler } from "./ScreeningActionButtonHandler";

const GUILD = "187450744427773963";
const OTHER_GUILD = "187450744427773964";
const USER = "1202420700607029308";
const MOD = "150443906511667200";
const POST = "1558174981962079999";
const OTHER_POST = "1558174981962070000";
const VERDICT_ID = 9431;
const NOW = new Date("2026-10-25T12:00:00.000Z");
const WEEK_AGO = new Date("2026-10-18T12:00:00.000Z");
const INTERACTION_ID = "1558174981962080000";
const ALL_PERMISSIONS = [
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
];

function verdict(overrides: Partial<ScreeningVerdict> = {}): ScreeningVerdict {
  return {
    id: VERDICT_ID,
    guildId: GUILD,
    userId: USER,
    postMessageId: POST,
    createdAt: NOW,
    ...overrides,
  } as ScreeningVerdict;
}

function unknownMember(): DiscordAPIError {
  return new DiscordAPIError(
    { message: "Unknown Member", code: RESTJSONErrorCodes.UnknownMember },
    RESTJSONErrorCodes.UnknownMember,
    404,
    "GET",
    `/guilds/${GUILD}/members/${USER}`,
    {},
  );
}

function unknownUser(): DiscordAPIError {
  return new DiscordAPIError(
    { message: "Unknown User", code: RESTJSONErrorCodes.UnknownUser },
    RESTJSONErrorCodes.UnknownUser,
    404,
    "GET",
    `/users/${USER}`,
    {},
  );
}

function makeRepo() {
  return {
    findById: mock(async (): Promise<ScreeningVerdict | null> => verdict()),
    setActioned: mock(async (): Promise<ScreeningVerdict[]> => [verdict()]),
    updateOutcomeAction: mock(
      async (): Promise<ScreeningVerdict[]> => [verdict()],
    ),
  };
}

function makeModal(
  opts: {
    reason?: string;
    duration?: string;
    deleteSeconds?: string;
    template?: string;
    save?: boolean;
  } = {},
) {
  const submitted = new Map<string, unknown>([
    ["reason", { customId: "reason", value: opts.reason ?? "" }],
    ["save_as_template", { customId: "save_as_template", value: !!opts.save }],
  ]);
  if (opts.template) {
    submitted.set("reason_template", {
      customId: "reason_template",
      values: [opts.template],
    });
  }
  return {
    fields: {
      fields: submitted,
      getTextInputValue: () => opts.reason ?? "",
      getCheckbox: () => !!opts.save,
      getCheckboxGroup: () => [],
      getStringSelectValues: (id: string) => {
        if (id === "duration") {
          return [opts.duration ?? "1h"];
        }
        if (id === "delete_seconds" && opts.deleteSeconds) {
          return [opts.deleteSeconds];
        }
        if (id === "reason_template" && opts.template) {
          return [opts.template];
        }
        throw new Error(`missing ${id}`);
      },
    },
    guildId: GUILD,
    user: { id: MOD },
    inCachedGuild: () => true,
    reply: mock(async () => undefined),
    deferUpdate: mock(async () => undefined),
    deleteReply: mock(async () => undefined),
    followUp: mock(async () => undefined),
    editReply: mock(async () => undefined),
  };
}

const TEMPLATE = {
  id: "11",
  guildId: GUILD,
  shortcut: "spam",
  content: "Spamming in channels (rule 3).",
  contentKey: "k",
  createdBy: MOD,
  createdAt: NOW,
  updatedAt: null,
  useCount: 3,
  lastUsedAt: null,
};

function makeFormDeps() {
  return {
    reasonTemplateService: {
      getFormData: mock(async () => ({ last: null, templates: [TEMPLATE] })),
      resolve: mock(async (_guildId: string, input: string | null) =>
        input
          ? {
              text: input,
              template: null,
              unknownShortcut: null,
              source: "none" as const,
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
}

const postEdit = mock(async () => undefined);

function makeInteraction(
  actionType: string,
  opts: { granted?: bigint[]; modal?: ReturnType<typeof makeModal> } = {},
) {
  const granted = opts.granted ?? ALL_PERMISSIONS;
  const targetUser = { id: USER };
  const modal = opts.modal ?? makeModal();
  return {
    id: INTERACTION_ID,
    customId: `/screening/action/${actionType}/${VERDICT_ID}`,
    guildId: GUILD,
    channelId: "1029384756102938400",
    user: { id: MOD },
    member: { id: MOD },
    message: { id: POST },
    memberPermissions: { any: (p: bigint) => granted.includes(p) },
    inCachedGuild: () => true,
    reply: mock(async () => undefined),
    showModal: mock(async () => undefined),
    awaitModalSubmit: mock(async () => modal),
    guild: {
      members: {
        cache: new Map([[USER, { displayName: "spambot" }]]),
        fetch: mock(
          async (): Promise<unknown> => ({ id: USER, user: targetUser }),
        ),
      },
    },
    client: {
      users: {
        cache: new Map(),
        fetch: mock(async (): Promise<unknown> => targetUser),
      },
      channels: {
        fetch: mock(async () => ({
          isTextBased: () => true,
          messages: { edit: postEdit },
        })),
      },
    },
    modal,
  };
}

describe("ScreeningActionButtonHandler", () => {
  let repo: ReturnType<typeof makeRepo>;
  let container: ContainerBuilder;
  let renderer: { renderPost: ReturnType<typeof mock> };
  let metrics: {
    recordCheck: ReturnType<typeof mock>;
    recordOutcome: ReturnType<typeof mock>;
  };
  let executeAction: ReturnType<typeof mock>;
  let postRefresher: { refreshPosts: ReturnType<typeof mock> };
  let handler: ScreeningActionButtonHandler;
  let formDeps: ReturnType<typeof makeFormDeps>;

  beforeEach(() => {
    setSystemTime(NOW);
    repo = makeRepo();
    container = new ContainerBuilder();
    renderer = { renderPost: mock(async () => container) };
    metrics = { recordCheck: mock(), recordOutcome: mock() };
    executeAction = mock(async () => [Ok({ caseId: "12" })]);
    postRefresher = { refreshPosts: mock(async () => undefined) };
    formDeps = makeFormDeps();
    postEdit.mockClear();
    handler = new ScreeningActionButtonHandler(
      { executeAction } as unknown as Pick<ModerationService, "executeAction">,
      repo as unknown as ScreeningVerdictRepository,
      renderer,
      postRefresher,
      metrics as ScreeningMetrics,
      formDeps as unknown as ActionReasonFormDeps,
      pino({ level: "silent" }),
    );
  });

  afterEach(() => {
    setSystemTime();
  });

  async function run(interaction: ReturnType<typeof makeInteraction>) {
    await handler.handleInteraction(
      interaction as unknown as ButtonInteraction,
    );
  }

  function executed(): { action: ModerationAction; target: ModerationTarget } {
    const call = executeAction.mock.calls[0] as unknown as [
      ModerationAction,
      ModerationTarget[],
    ];
    return { action: call[0], target: call[1][0] as ModerationTarget };
  }

  test("denies timeout with only Ban Members", async () => {
    const interaction = makeInteraction("timeout", {
      granted: [PermissionFlagsBits.BanMembers],
    });

    await run(interaction);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(repo.findById).not.toHaveBeenCalled();
  });

  test("denies ban with only Timeout Members", async () => {
    const interaction = makeInteraction("ban", {
      granted: [PermissionFlagsBits.ModerateMembers],
    });

    await run(interaction);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(interaction.showModal).not.toHaveBeenCalled();
  });

  test("throws on a corrupted verdict id", async () => {
    const interaction = makeInteraction("ban");
    interaction.customId = "/screening/action/ban/abc";

    await expect(run(interaction)).rejects.toThrow(
      "Invalid screening verdict id",
    );
    expect(repo.findById).not.toHaveBeenCalled();
  });

  test("refuses a verdict from another guild", async () => {
    repo.findById.mockResolvedValueOnce(verdict({ guildId: OTHER_GUILD }));
    const interaction = makeInteraction("ban");

    await run(interaction);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(interaction.showModal).not.toHaveBeenCalled();
  });

  test("ban marks the member's flags actioned and re-renders the post", async () => {
    const interaction = makeInteraction("ban", {
      modal: makeModal({ reason: "scam", deleteSeconds: "86400" }),
    });

    await run(interaction);

    const modalId = `reasonForm/${INTERACTION_ID}`;
    const modal = (
      interaction.showModal.mock.calls[0] as unknown as [
        { custom_id: string; title: string },
      ]
    )[0];
    expect(modal.custom_id).toBe(modalId);
    expect(modal.title).toBe("Ban spambot");
    const { filter } = (
      interaction.awaitModalSubmit.mock.calls[0] as unknown as [
        { filter: (i: unknown) => boolean },
      ]
    )[0];
    expect(filter({ user: { id: MOD }, customId: modalId })).toBe(true);
    expect(
      filter({
        user: { id: MOD },
        customId: `/screening/action/ban/${VERDICT_ID}`,
      }),
    ).toBe(false);
    expect(formDeps.reasonTemplateService.getFormData).toHaveBeenCalledWith(
      GUILD,
    );

    const { action, target } = executed();
    expect(action).toBeInstanceOf(BanAction);
    expect(action.reason?.value).toBe("scam");
    expect(action.dmChoice).toBe("unspecified");
    expect((action as BanAction).deleteMessageSeconds).toBe(86400);
    expect(target.id).toBe(USER);

    expect(repo.setActioned).toHaveBeenCalledWith(
      GUILD,
      USER,
      WEEK_AGO,
      MOD,
      "banned",
      NOW,
    );
    expect(repo.updateOutcomeAction).not.toHaveBeenCalled();
    expect(renderer.renderPost).toHaveBeenCalledWith(POST);
    expect(interaction.modal.editReply).toHaveBeenCalledWith({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
    expect(metrics.recordOutcome).toHaveBeenCalledWith("actioned", {
      source: "button",
    });
  });

  test("ban on an already-resolved post credits the moderator", async () => {
    repo.setActioned.mockResolvedValueOnce([]);
    const interaction = makeInteraction("ban");

    await run(interaction);

    expect(repo.updateOutcomeAction).toHaveBeenCalledWith(
      POST,
      "banned",
      MOD,
      NOW,
    );
    expect(interaction.modal.editReply).toHaveBeenCalledTimes(1);
    expect(metrics.recordOutcome).not.toHaveBeenCalled();
  });

  test("ban that resolved only another post still credits the clicked post", async () => {
    repo.setActioned.mockResolvedValueOnce([
      verdict({ id: 9000, postMessageId: OTHER_POST }),
    ]);
    const interaction = makeInteraction("ban");

    await run(interaction);

    expect(repo.updateOutcomeAction).toHaveBeenCalledWith(
      POST,
      "banned",
      MOD,
      NOW,
    );
    expect(metrics.recordOutcome).toHaveBeenCalledWith("actioned", {
      source: "button",
    });
  });

  test("ban reaches back to a verdict older than the lookback", async () => {
    const created = new Date("2026-10-01T00:00:00.000Z");
    repo.findById.mockResolvedValueOnce(verdict({ createdAt: created }));
    const interaction = makeInteraction("ban");

    await run(interaction);

    expect(repo.setActioned).toHaveBeenCalledWith(
      GUILD,
      USER,
      created,
      MOD,
      "banned",
      NOW,
    );
  });

  test("bans a member who left via the user fetch", async () => {
    const interaction = makeInteraction("ban");
    interaction.guild.members.fetch.mockRejectedValueOnce(unknownMember());

    await run(interaction);

    expect(interaction.client.users.fetch).toHaveBeenCalledWith(USER);
    const { target } = executed();
    expect(target.id).toBe(USER);
    expect(target.member).toBeNull();
  });

  test("rethrows member fetch errors other than Unknown Member", async () => {
    const interaction = makeInteraction("ban");
    interaction.guild.members.fetch.mockRejectedValueOnce(
      new Error("Service Unavailable"),
    );

    await expect(run(interaction)).rejects.toThrow("Service Unavailable");

    expect(interaction.client.users.fetch).not.toHaveBeenCalled();
    expect(executeAction).not.toHaveBeenCalled();
  });

  test("replies when the target user can't be fetched", async () => {
    const interaction = makeInteraction("ban");
    interaction.guild.members.fetch.mockRejectedValueOnce(unknownMember());
    interaction.client.users.fetch.mockRejectedValueOnce(unknownUser());

    await run(interaction);

    expect(interaction.modal.followUp).toHaveBeenCalledTimes(1);
    expect(executeAction).not.toHaveBeenCalled();
  });

  test("rethrows unexpected user fetch errors", async () => {
    const interaction = makeInteraction("ban");
    interaction.guild.members.fetch.mockRejectedValueOnce(unknownMember());
    interaction.client.users.fetch.mockRejectedValueOnce(new Error("boom"));

    await expect(run(interaction)).rejects.toThrow("boom");
    expect(executeAction).not.toHaveBeenCalled();
  });

  test("too long after adding the template: nothing done, Try again reopens prefilled", async () => {
    const interaction = makeInteraction("ban", {
      modal: makeModal({
        reason: "x".repeat(2990),
        template: "template:11",
        deleteSeconds: "86400",
      }),
    });

    await run(interaction);

    expect(executeAction).not.toHaveBeenCalled();
    expect(interaction.modal.deferUpdate).not.toHaveBeenCalled();
    const reply = (
      interaction.modal.reply.mock.calls[0] as unknown as [
        {
          flags: number;
          components: { toJSON(): { components: Record<string, unknown>[] } }[];
        },
      ]
    )[0];
    expect(reply.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
    const [text, row] = reply.components[0]?.toJSON().components ?? [];
    expect(text?.content).toContain("**Nothing was done.**");
    expect(text?.content).toContain("Shorten the details by 21 characters.");
    const retryButton = (
      row?.components as { custom_id: string; label: string }[]
    )[0];
    expect(retryButton.label).toBe("Try again");
    expect(handler.customIDMatch(retryButton.custom_id)).not.toBe(false);

    // Try again from the ephemeral error: same flow, form prefilled, post edited over REST.
    const retryModal = makeModal({ reason: "short", deleteSeconds: "86400" });
    const retry = makeInteraction("ban", { modal: retryModal });
    retry.customId = retryButton.custom_id;
    retry.id = "1558174981962080001";
    await run(retry);

    const prefilled = (
      retry.showModal.mock.calls[0] as unknown as [
        { components: { component: Record<string, unknown> }[] },
      ]
    )[0];
    const byId = Object.fromEntries(
      prefilled.components.map((c) => [c.component.custom_id, c.component]),
    );
    expect(byId.reason).toMatchObject({ value: "x".repeat(2990) });
    expect(
      (byId.reason_template?.options as { value: string; default?: boolean }[])
        .filter((o) => o.default)
        .map((o) => o.value),
    ).toEqual(["template:11"]);

    expect(executed().action.reason?.value).toBe("short");
    expect(postEdit).toHaveBeenCalledWith(POST, {
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
    expect(retryModal.deleteReply).toHaveBeenCalledTimes(1);
    expect(retryModal.editReply).not.toHaveBeenCalled();

    // The input is dropped once used.
    const again = makeInteraction("ban");
    again.customId = retryButton.custom_id;
    await run(again);
    expect(again.showModal).not.toHaveBeenCalled();
    expect(again.reply).toHaveBeenCalledTimes(1);
  });

  test("an unresolved template pick refuses the action", async () => {
    formDeps.reasonTemplateService.resolve.mockResolvedValueOnce({
      text: "!spam · Spamming…",
      template: null,
      unknownShortcut: null,
      source: "none",
      unresolved: { kind: "stale_label", input: "!spam · Spamming…" },
    } as never);
    const interaction = makeInteraction("ban", {
      modal: makeModal({ reason: "!spam · Spamming…" }),
    });

    await run(interaction);

    expect(executeAction).not.toHaveBeenCalled();
    expect(JSON.stringify(interaction.modal.reply.mock.calls[0])).toContain(
      "old or edited template pick",
    );
  });

  test("a picked template is expanded, recorded and can be saved", async () => {
    formDeps.reasonTemplateService.create.mockResolvedValueOnce(
      Err({ code: "duplicate", existing: TEMPLATE }) as never,
    );
    const interaction = makeInteraction("ban", {
      modal: makeModal({ template: "template:11", reason: "", save: true }),
    });

    await run(interaction);

    expect(executed().action.reason?.value).toBe(TEMPLATE.content);
    expect(formDeps.reasonTemplateService.recordUse).toHaveBeenCalledWith(
      GUILD,
      "11",
    );
    // A duplicate never blocks the action; it becomes a private note.
    expect(interaction.modal.editReply).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(interaction.modal.followUp.mock.calls)).toContain(
      "already the template `!spam`",
    );
  });

  test("throws when the post has no verdict to render", async () => {
    renderer.renderPost.mockResolvedValueOnce(null);
    const interaction = makeInteraction("ban");

    await expect(run(interaction)).rejects.toThrow(
      "Actioned screening post has no verdict",
    );
  });

  test("ban refreshes the member's other posts after the clicked one", async () => {
    const other = verdict({ id: 9000, postMessageId: OTHER_POST });
    repo.setActioned.mockResolvedValueOnce([verdict(), other]);
    const interaction = makeInteraction("ban");

    await run(interaction);

    expect(postRefresher.refreshPosts).toHaveBeenCalledWith([other]);
    const [editOrder] = interaction.modal.editReply.mock.invocationCallOrder;
    const [refreshOrder] = postRefresher.refreshPosts.mock.invocationCallOrder;
    expect(editOrder).toBeLessThan(refreshOrder as number);
  });

  test("ban touching only the clicked post refreshes nothing else", async () => {
    const interaction = makeInteraction("ban");

    await run(interaction);

    expect(postRefresher.refreshPosts).not.toHaveBeenCalled();
  });

  test("unban updates the outcome action only", async () => {
    const interaction = makeInteraction("unban");

    await run(interaction);

    expect(executed().action).toBeInstanceOf(UnbanAction);
    expect(repo.setActioned).not.toHaveBeenCalled();
    expect(postRefresher.refreshPosts).not.toHaveBeenCalled();
    expect(repo.updateOutcomeAction).toHaveBeenCalledWith(
      POST,
      "unbanned",
      MOD,
      NOW,
    );
    expect(interaction.modal.editReply).toHaveBeenCalledTimes(1);
    expect(metrics.recordOutcome).not.toHaveBeenCalled();
  });

  test("timeout uses the selected duration", async () => {
    const interaction = makeInteraction("timeout", {
      modal: makeModal({ duration: "1d" }),
    });

    await run(interaction);

    const { action } = executed();
    expect(action).toBeInstanceOf(TimeoutAction);
    expect((action as TimeoutAction).duration.asSeconds()).toBe(86400);
    expect(repo.setActioned).toHaveBeenCalledWith(
      GUILD,
      USER,
      WEEK_AGO,
      MOD,
      "timed out 1d",
      NOW,
    );
  });

  test("untimeout records timeout removed", async () => {
    const interaction = makeInteraction("untimeout");

    await run(interaction);

    expect(repo.updateOutcomeAction).toHaveBeenCalledWith(
      POST,
      "timeout removed",
      MOD,
      NOW,
    );
  });

  test("an invalid duration stops before the action", async () => {
    const interaction = makeInteraction("timeout", {
      modal: makeModal({ duration: "28d" }),
    });

    await run(interaction);

    expect(interaction.modal.followUp).toHaveBeenCalledTimes(1);
    expect(executeAction).not.toHaveBeenCalled();
  });

  test("a failed action replies with the error and leaves the post", async () => {
    executeAction.mockResolvedValueOnce([Err("Missing permissions")]);
    const interaction = makeInteraction("ban");

    await run(interaction);

    expect(interaction.modal.followUp).toHaveBeenCalledTimes(1);
    const reply = (
      interaction.modal.followUp.mock.calls[0] as unknown as [
        {
          components: { components: { content: string }[] }[];
          ephemeral: boolean;
        },
      ]
    )[0];
    expect(reply.ephemeral).toBe(true);
    expect(reply.components[0]?.components[0]?.content).toBe(
      "Action failed: Missing permissions",
    );
    expect(repo.setActioned).not.toHaveBeenCalled();
    expect(repo.updateOutcomeAction).not.toHaveBeenCalled();
    expect(interaction.modal.editReply).not.toHaveBeenCalled();
  });

  test("a dismissed modal does nothing", async () => {
    const interaction = makeInteraction("ban");
    interaction.awaitModalSubmit.mockRejectedValueOnce(new Error("timeout"));

    await run(interaction);

    expect(executeAction).not.toHaveBeenCalled();
  });
});
