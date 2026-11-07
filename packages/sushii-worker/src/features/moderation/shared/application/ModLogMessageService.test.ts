import { sleep } from "bun";
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { Client, Message } from "discord.js";
import {
  Collection,
  DiscordAPIError,
  MessageFlags,
  RESTJSONErrorCodes,
  Routes,
} from "discord.js";
import pino from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { CaseProof } from "../domain/entities/CaseProof";
import { ModerationCase } from "../domain/entities/ModerationCase";
import type { CaseProofRepository } from "../domain/repositories/CaseProofRepository";
import { ActionType } from "../domain/value-objects/ActionType";
import { Reason } from "../domain/value-objects/Reason";
import { proofEntryText } from "../presentation/proof/proofBlock";
import type { ModLogMessage } from "../presentation/views/ModLogMessageView";
import {
  MESSAGE_TEXT_MAX_LENGTH,
  MOD_LOG_FACTS_ID,
  messageTextLength,
} from "../presentation/views/ModLogMessageView";
import type { KeyedMutex } from "./KeyedMutex";
import {
  DELETE_DM_PROMPT_RESERVE,
  MORE_PROOF_LINE_RESERVE,
  ModLogMessageService,
} from "./ModLogMessageService";
import { postedFiles, postedFilesOf } from "./proofHosting";

const GUILD = "187450744427773963";
const TARGET = "912345678901234567";
const EXECUTOR = "150443906511667200";
const LOG_CHANNEL = "1029384756102938400";
const LOG_MESSAGE = "1029384756102938499";
const LOG_REPLY = "1029384756102938600";
const MOD = "238381427315195904";
const DM = {
  channelId: "1029384756102938401",
  messageId: "1029384756102938402",
};

function makeCase(
  options: {
    msgId?: string | null;
    pending?: boolean;
    actionType?: ActionType;
    timeoutDuration?: number | null;
    userTag?: string;
  } = {},
): ModerationCase {
  return new ModerationCase(
    GUILD,
    "4822",
    options.actionType ?? ActionType.Ban,
    new Date("2026-10-27T11:00:00.000Z"),
    TARGET,
    options.userTag ?? "spambot",
    EXECUTOR,
    null,
    options.msgId === undefined ? LOG_MESSAGE : options.msgId,
    [],
    DM,
    options.pending ?? false,
    options.timeoutDuration ?? null,
  );
}

function flagField(bits: number) {
  return {
    bitfield: bits,
    has: (flag: number) => (bits & flag) === flag,
  };
}

function legacyMessage(
  fields: { name: string; value: string }[],
  buttonLabel = "Reason DM sent",
  suppressed = false,
) {
  const embeds = [{ fields }];
  const components = [
    {
      toJSON: () => ({
        type: 1,
        components: [{ type: 2, label: buttonLabel }],
      }),
    },
  ];
  return {
    id: LOG_MESSAGE,
    channelId: LOG_CHANNEL,
    flags: flagField(suppressed ? MessageFlags.SuppressEmbeds : 0),
    embeds,
    components,
    toJSON: () => ({ embeds, components: components.map((c) => c.toJSON()) }),
    attachments: new Map(),
    edit: mock(async () => undefined),
  };
}

interface FakeFile {
  id: string;
  filename: string;
  url: string;
}

function cdnUrl(id: string, name: string): string {
  return `https://cdn.discordapp.com/attachments/${LOG_CHANNEL}/${id}/${name}?ex=1&is=2&hm=3&`;
}

let nextFileId = 1029384756102939000n;

/**
 * A posted message built from a send/edit payload the way Discord returns
 * it: attachment:// refs resolved with an attachment_id, files a component
 * references left out of `attachments`.
 */
function postedFrom(
  payload: {
    components?: { toJSON(): unknown }[];
    files?: { name?: string | null }[];
    attachments?: { id: string }[];
  },
  id: string,
  previous: FakeFile[] = [],
) {
  const kept = previous.filter((f) =>
    payload.attachments ? payload.attachments.some((a) => a.id === f.id) : true,
  );
  const added = (payload.files ?? []).map((f) => {
    const fileId = String(nextFileId++);
    return {
      id: fileId,
      filename: f.name ?? "",
      url: cdnUrl(fileId, f.name ?? ""),
    };
  });
  const all = [...kept, ...added];
  const referenced = new Set<string>();
  const json = JSON.parse(
    JSON.stringify((payload.components ?? []).map((c) => c.toJSON())),
    (key, value) => {
      if (key === "media" && typeof value?.url === "string") {
        const ref = value.url.startsWith("attachment://")
          ? value.url.slice("attachment://".length)
          : null;
        const file = all.find((f) =>
          ref ? f.filename === ref : f.url === value.url,
        );
        if (file) {
          referenced.add(file.id);
          return { url: file.url, attachment_id: file.id };
        }
      }
      return value;
    },
  ) as unknown[];

  return fakeMessage(id, json, all, referenced);
}

function fakeMessage(
  id: string,
  components: unknown[],
  files: FakeFile[] = [],
  referenced = new Set<string>(),
) {
  const message = {
    id,
    channelId: LOG_CHANNEL,
    flags: flagField(MessageFlags.IsComponentsV2),
    embeds: [],
    components: components.map((c) => ({ toJSON: () => c })),
    attachments: new Map(
      files
        .filter((f) => !referenced.has(f.id))
        .map((f) => [f.id, { id: f.id, name: f.filename, url: f.url }]),
    ),
    files,
    toJSON: () => ({ embeds: [], components }),
    edit: mock(async (payload: never) => postedFrom(payload, id, files)),
    reply: mock(async (payload: never) => postedFrom(payload, LOG_REPLY, [])),
    fetch: mock(async () => message),
    delete: mock(async () => undefined),
  };
  return message;
}

function v2Message(facts: string | null, files: FakeFile[] = []) {
  const container = {
    type: 17,
    components: [
      ...(facts ? [{ type: 10, id: MOD_LOG_FACTS_ID, content: facts }] : []),
      ...(files.length > 0
        ? [
            {
              type: 12,
              items: files.map((f) => ({
                media: { url: f.url, attachment_id: f.id },
              })),
            },
          ]
        : []),
    ],
  };
  return fakeMessage(
    LOG_MESSAGE,
    [container],
    files,
    new Set(files.map((f) => f.id)),
  );
}

function setup(
  options: {
    modLogChannel?: string | null;
    posted?: unknown;
    fetchError?: Error;
    userFetch?: ReturnType<typeof mock>;
    proofs?: CaseProof[];
    banDmText?: string | null;
    /** Called on every message fetch, so a test can serve the entry's latest state. */
    current?: () => unknown;
    findById?: ReturnType<typeof mock>;
    /** What a fetch for messages after a reply returns. */
    later?: { id: string; authorId: string; replyTo: string }[];
    deleteMessage?: ReturnType<typeof mock>;
  } = {},
) {
  const listByCase = mock(async () => options.proofs ?? []);
  const updateHosting = mock(async () => undefined);
  const removeRow = mock(async () => null);
  const deleteMessage = options.deleteMessage ?? mock(async () => undefined);
  const caseProofRepository = {
    listByCase,
    updateHosting,
    remove: removeRow,
  } as unknown as CaseProofRepository;
  const patch = mock(async () => undefined);
  const markDmDeleted = mock(async () => undefined);
  const findById = options.findById ?? mock(async () => null);
  const recordModLogEdit = mock();
  const users = new Map([
    [
      EXECUTOR,
      { id: EXECUTOR, tag: "tzuyu", displayAvatarURL: () => "https://x/e.png" },
    ],
  ]);
  const client = {
    user: { id: "1" },
    rest: { patch },
    users: {
      cache: users,
      fetch:
        options.userFetch ??
        mock(async () => ({
          id: TARGET,
          tag: "renamed_now",
          displayAvatarURL: () => "https://cdn.discordapp.com/avatars/x.png",
        })),
    },
    channels: {
      fetch: mock(async () => ({
        isTextBased: () => true,
        messages: {
          fetch: options.fetchError
            ? mock(async () => {
                throw options.fetchError;
              })
            : mock(async (query: unknown) =>
                typeof query === "object" && query && "after" in query
                  ? new Collection(
                      (options.later ?? []).map((m) => [
                        m.id,
                        {
                          id: m.id,
                          author: { id: m.authorId },
                          reference: { messageId: m.replyTo },
                        },
                      ]),
                    )
                  : (options.current?.() ?? options.posted ?? v2Message(null)),
              ),
          delete: deleteMessage,
        },
      })),
    },
  } as unknown as Client;
  const guildConfigRepository = {
    findByGuildId: mock(async () => ({
      loggingSettings: {
        modLogChannel:
          options.modLogChannel === undefined
            ? LOG_CHANNEL
            : options.modLogChannel,
        modLogEnabled: true,
      },
      moderationSettings: { banDmText: options.banDmText ?? null },
    })),
  } as unknown as GuildConfigRepository;
  const emojiRepository = {
    getEmojis: mock(async (names: readonly string[]) =>
      Object.fromEntries(names.map((n) => [n, ""])),
    ),
  } as unknown as BotEmojiRepository;

  return {
    patch,
    markDmDeleted,
    recordModLogEdit,
    listByCase,
    updateHosting,
    removeRow,
    deleteMessage,
    client,
    service: new ModLogMessageService(
      client,
      guildConfigRepository,
      emojiRepository,
      { markDmDeleted, findById } as never,
      caseProofRepository,
      pino({ level: "silent" }),
      { recordModLogEdit },
      { totalMs: 30, pollMs: 10 },
    ),
  };
}

function text(message: ModLogMessage): string {
  return JSON.stringify(message.components[0]?.toJSON());
}

describe("ModLogMessageService.refresh", () => {
  test("edits a components v2 entry, keeping its facts block", async () => {
    const posted = v2Message("-# Timeout would have ended <t:1:R>");
    const { service, patch, recordModLogEdit } = setup({ posted });

    expect(
      await service.refresh(makeCase({ actionType: ActionType.TimeoutRemove })),
    ).toBe("updated");
    expect(recordModLogEdit.mock.calls).toEqual([["v2", "ok"]]);

    expect(patch).not.toHaveBeenCalled();
    const [payload] = posted.edit.mock.calls[0] as unknown as [ModLogMessage];
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(text(payload)).toContain("Timeout would have ended <t:1:R>");
  });

  test("converts a legacy embed entry over REST with content null", async () => {
    const posted = legacyMessage([
      { name: "Timeout Duration", value: "1 hour\nExpiring <t:5:R>" },
      { name: "Previous Timeout", value: "Would have expired <t:3:R>" },
    ]);
    const { service, patch, recordModLogEdit } = setup({ posted });

    expect(
      await service.refresh(
        makeCase({
          actionType: ActionType.TimeoutAdjust,
          timeoutDuration: null,
        }),
      ),
    ).toBe("updated");
    expect(recordModLogEdit.mock.calls).toEqual([["legacy_conversion", "ok"]]);

    expect(posted.edit).not.toHaveBeenCalled();
    const [route, { body }] = patch.mock.calls[0] as unknown as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(route).toBe(Routes.channelMessage(LOG_CHANNEL, LOG_MESSAGE));
    expect(Object.keys(body).sort()).toEqual([
      "allowed_mentions",
      "components",
      "content",
      "embeds",
      "flags",
    ]);
    expect(body.content).toBeNull();
    expect(body.embeds).toEqual([]);
    expect(body.flags).toBe(MessageFlags.IsComponentsV2);
    expect(body.allowed_mentions).toEqual({ parse: [] });
    const components = JSON.stringify(body.components);
    expect(components).toContain("Timeout Duration: 1 hour · Expiring <t:5:R>");
    expect(components).toContain(
      "Previous Timeout: Would have expired <t:3:R>",
    );
  });

  test("a legacy entry showing the DM as deleted is stored as deleted first", async () => {
    const posted = legacyMessage([], "Reason DM deleted");
    const { service, patch, markDmDeleted } = setup({ posted });

    const entry = await service.loadEntry(makeCase());

    expect(markDmDeleted).toHaveBeenCalledWith(GUILD, "4822", null, null);
    expect(entry.moderationCase.dmDeleted).toBe(true);

    await service.refreshEntry(entry, entry.moderationCase);
    const body = (
      patch.mock.calls[0] as unknown as [
        string,
        { body: { components: unknown[] } },
      ]
    )[1].body;
    expect(JSON.stringify(body.components)).toContain("not sent (DM deleted)");
    expect(JSON.stringify(body.components)).not.toContain("Delete DM");
  });

  test("a pending case has no message yet", async () => {
    const { service, recordModLogEdit } = setup();

    expect(
      await service.refresh(makeCase({ msgId: null, pending: true })),
    ).toBe("pending");
    expect(await service.refresh(makeCase({ msgId: null }))).toBe("no_message");
    expect(recordModLogEdit).not.toHaveBeenCalled();
  });

  test("no mod log channel", async () => {
    const { service, recordModLogEdit } = setup({ modLogChannel: null });

    expect(await service.refresh(makeCase())).toBe("not_configured");
    expect(recordModLogEdit).not.toHaveBeenCalled();
  });

  test("a message that can't be fetched or edited is returned, not thrown", async () => {
    const unfetched = setup({ fetchError: new Error("Unknown Message") });
    expect(await unfetched.service.refresh(makeCase())).toBe("failed");
    expect(unfetched.recordModLogEdit).not.toHaveBeenCalled();

    const posted = v2Message(null);
    posted.edit.mockRejectedValueOnce(new Error("Missing Access"));
    const unedited = setup({ posted });
    expect(await unedited.service.refresh(makeCase())).toBe("failed");
    expect(unedited.recordModLogEdit.mock.calls).toEqual([["v2", "failed"]]);
  });
});

describe("ModLogMessageService.render", () => {
  test("keeps the recorded target name and names the executor in plain text", async () => {
    const { service } = setup();

    const json = text(await service.render(makeCase()));

    expect(json).toContain(`<@${TARGET}> · spambot · \`${TARGET}\``);
    expect(json).not.toContain("renamed_now");
    expect(json).toContain(`**Moderator:** <@${EXECUTOR}> · tzuyu`);
  });

  test("falls back to a default avatar when the user can't be fetched", async () => {
    const { service } = setup({
      userFetch: mock(async () => {
        throw new Error("Unknown User");
      }),
    });

    const json = text(await service.render(makeCase()));

    expect(json).toContain(`**User:** <@${TARGET}>`);
    expect(json).toMatch(/embed\/avatars\/\d\.png/);
  });
});

describe("ModLogMessageService.updateFromInteraction", () => {
  test("a failed legacy conversion is returned, never thrown, after the ack", async () => {
    const { service, patch, recordModLogEdit } = setup();
    patch.mockRejectedValueOnce(new Error("Invalid Form Body"));
    const interaction = {
      message: legacyMessage([], "Reason DM sent", true) as unknown as Message,
      update: mock(async () => undefined),
      deferUpdate: mock(async () => undefined),
      editReply: mock(async () => undefined),
    };

    const outcome = await service.updateFromInteraction(
      interaction as never,
      await service.render(makeCase()),
    );

    expect(outcome).toBe("failed");
    expect(recordModLogEdit.mock.calls).toEqual([
      ["legacy_conversion", "failed"],
    ]);
    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.update).not.toHaveBeenCalled();
    const [, { body }] = patch.mock.calls[0] as unknown as [
      string,
      { body: { flags: number } },
    ];
    expect(body.flags).toBe(
      MessageFlags.SuppressEmbeds | MessageFlags.IsComponentsV2,
    );
  });

  test("a components v2 entry is updated through the interaction", async () => {
    const { service, patch, recordModLogEdit } = setup();
    const interaction = {
      message: v2Message(null),
      update: mock(async () => undefined),
      deferUpdate: mock(async () => undefined),
    };
    const message = await service.render(makeCase());

    expect(
      await service.updateFromInteraction(interaction as never, message),
    ).toBe("updated");

    expect(interaction.update).toHaveBeenCalledWith(message);
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(recordModLogEdit.mock.calls).toEqual([["v2", "ok"]]);
  });

  test("a failed interaction update is counted and rethrown", async () => {
    const { service, recordModLogEdit } = setup();
    const interaction = {
      message: v2Message(null),
      update: mock(async () => {
        throw new Error("Unknown interaction");
      }),
      deferUpdate: mock(async () => undefined),
    };

    const message = await service.render(makeCase());

    await expect(
      service.updateFromInteraction(interaction as never, message),
    ).rejects.toThrow("Unknown interaction");
    expect(recordModLogEdit.mock.calls).toEqual([["v2", "failed"]]);
  });

  test("a legacy entry is acknowledged, then converted over REST", async () => {
    const { service, patch } = setup();
    const interaction = {
      message: legacyMessage([]) as unknown as Message,
      update: mock(async () => undefined),
      deferUpdate: mock(async () => undefined),
    };
    const message = await service.render(makeCase());

    await service.updateFromInteraction(interaction as never, message);

    expect(interaction.update).not.toHaveBeenCalled();
    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith(
      Routes.channelMessage(LOG_CHANNEL, LOG_MESSAGE),
      {
        body: {
          flags: MessageFlags.IsComponentsV2,
          components: message.components.map((c) => c.toJSON()),
          embeds: [],
          content: null,
          allowed_mentions: { parse: [] },
        },
      },
    );
  });
});

const PROOF_TIME = new Date("2026-10-27T11:30:00.000Z");

function makeProof(o: Partial<CaseProof> = {}): CaseProof {
  return {
    id: "1",
    guildId: GUILD,
    caseId: "4822",
    authorId: MOD,
    createdAt: PROOF_TIME,
    content: null,
    attachments: [],
    sourceMessageUrl: null,
    sourceAuthorId: null,
    sourceContent: null,
    hostMessageId: null,
    source: "button",
    ...o,
  };
}

function draft(o: Partial<CaseProof> = {}) {
  const {
    id: _id,
    createdAt: _createdAt,
    ...rest
  } = makeProof({
    content: "Same scam DMs",
    ...o,
  });
  return { ...rest, createdAt: PROOF_TIME };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) {
    await sleep(5);
  }
  expect(condition()).toBe(true);
}

function upload(name: string) {
  return { name, data: Buffer.from(name), contentType: "image/png" };
}

function existingFiles(count: number): FakeFile[] {
  return Array.from({ length: count }, (_, i) => {
    const id = String(1029384756102938700n + BigInt(i));
    return { id, filename: `old${i}.png`, url: cdnUrl(id, `old${i}.png`) };
  });
}

function editPayload(message: { edit: ReturnType<typeof mock> }, call = 0) {
  return message.edit.mock.calls[call]?.[0] as unknown as {
    components: { toJSON(): unknown }[];
    files?: { name: string }[];
    attachments?: { id: string }[];
  };
}

function payloadText(payload: { components: { toJSON(): unknown }[] }) {
  return JSON.stringify(payload.components.map((c) => c.toJSON()));
}

describe("ModLogMessageService.render with proof", () => {
  test("shows proof on the entry and links the first overflow reply", async () => {
    const { service } = setup({
      banDmText: "Appeal at example.com",
      proofs: [
        makeProof({
          id: "1",
          content: "on the entry",
          hostMessageId: LOG_MESSAGE,
        }),
        makeProof({ id: "2", content: "not hosted yet" }),
        makeProof({
          id: "3",
          content: "held by the overflow",
          hostMessageId: LOG_REPLY,
        }),
      ],
    });

    const json = text(
      await service.render(
        new ModerationCase(
          GUILD,
          "4822",
          ActionType.Ban,
          new Date(),
          TARGET,
          "spambot",
          EXECUTOR,
          null,
          LOG_MESSAGE,
          [],
          DM,
        ),
      ),
    );

    expect(json).toContain("on the entry");
    expect(json).toContain("not hosted yet");
    expect(json).not.toContain("held by the overflow");
    expect(json).toContain(
      `-# More proof in the reply below: https://discord.com/channels/${GUILD}/${LOG_CHANNEL}/${LOG_REPLY}`,
    );
    expect(json).toContain("-# Also included your server's ban message");
  });
});

describe("ModLogMessageService.hostProof", () => {
  test("text proof without an entry is saved unhosted; files are refused", async () => {
    const { service } = setup({ modLogChannel: null });

    expect(await service.hostProof(makeCase(), draft(), [])).toEqual({
      kind: "text_only",
      hostMessageId: null,
    });
    expect(
      await service.hostProof(makeCase(), draft(), [upload("a.png")]),
    ).toEqual({ kind: "no_mod_log" });
  });

  test("a fitting proof edits the entry, keeping its files by id", async () => {
    const old = existingFiles(1);
    const [kept] = old as [FakeFile];
    const posted = v2Message(null, old);
    const { service, recordModLogEdit } = setup({
      posted,
      proofs: [
        makeProof({ attachments: [kept.url], hostMessageId: LOG_MESSAGE }),
      ],
    });

    const result = await service.hostProof(makeCase(), draft(), [
      upload("shot.png"),
      upload("shot.png"),
    ]);

    const payload = editPayload(posted);
    // The kept file is referenced by the gallery, so it's only in components.
    expect(posted.attachments.size).toBe(0);
    expect(payload.attachments).toEqual([{ id: kept.id }]);
    const names = payload.files?.map((f) => f.name) ?? [];
    expect(new Set(names).size).toBe(2);
    expect(names).not.toContain(kept.filename);
    expect(payloadText(payload)).toContain(`attachment://${names[0]}`);
    expect(payloadText(payload)).toContain("Same scam DMs");

    expect(result).toEqual({
      kind: "hosted",
      hostMessageId: LOG_MESSAGE,
      attachmentUrls: [
        expect.stringMatching(new RegExp(`/${names[0]}\\?ex=1&is=2&hm=3&$`)),
        expect.stringMatching(new RegExp(`/${names[1]}\\?ex=1&is=2&hm=3&$`)),
      ],
    });
    expect(recordModLogEdit).toHaveBeenCalledWith("v2", "ok");
  });

  test("text-only proof edits the entry without touching its files", async () => {
    const old = existingFiles(2);
    const posted = v2Message(null, old);
    const { service } = setup({
      posted,
      proofs: [
        makeProof({
          attachments: old.map((f) => f.url),
          hostMessageId: LOG_MESSAGE,
        }),
      ],
    });

    expect(await service.hostProof(makeCase(), draft(), [])).toEqual({
      kind: "text_only",
      hostMessageId: LOG_MESSAGE,
    });
    const payload = editPayload(posted);
    expect(payloadText(payload)).toContain("Same scam DMs");
    // Omitted, so Discord keeps every file; an empty list would drop them.
    expect(payload.attachments).toBeUndefined();
    expect(payload.files).toBeUndefined();
  });

  test("files for an entry still being posted wait for it, then retry later", async () => {
    const pendingCase = makeCase({ msgId: null, pending: true });
    const posted = v2Message(null);
    const appears = setup({
      posted,
      findById: mock(async () => makeCase()),
    });
    expect(
      await appears.service.hostProof(pendingCase, draft(), [upload("a.png")]),
    ).toMatchObject({ kind: "hosted", hostMessageId: LOG_MESSAGE });

    const stillPending = setup({ findById: mock(async () => pendingCase) });
    expect(
      await stillPending.service.hostProof(pendingCase, draft(), [
        upload("a.png"),
      ]),
    ).toEqual({ kind: "retry_later" });

    const unfetchable = setup({ fetchError: new Error("Unknown Message") });
    expect(
      await unfetchable.service.hostProof(makeCase(), draft(), [
        upload("a.png"),
      ]),
    ).toEqual({ kind: "retry_later" });
  });

  test("two proofs added at once both keep every file", async () => {
    let latest = v2Message(null);
    const track = <T extends ReturnType<typeof fakeMessage>>(message: T): T => {
      const edit = message.edit;
      message.edit = mock(async (payload: never) => {
        const next = track(
          (await edit(payload)) as ReturnType<typeof fakeMessage>,
        );
        latest = next as typeof latest;
        return next;
      }) as typeof message.edit;
      return message;
    };
    track(latest);
    const stored: CaseProof[] = [];
    const { service, updateHosting } = setup({
      current: () => latest,
      proofs: stored,
    });
    updateHosting.mockImplementation(async () => undefined);

    const results = await Promise.all(
      ["a.png", "b.png"].map(async (name, i) => {
        const result = await service.hostProof(makeCase(), draft(), [
          upload(name),
        ]);
        const urls = (result as { attachmentUrls: string[] }).attachmentUrls;
        stored.push(
          makeProof({
            id: String(i + 1),
            attachments: urls,
            hostMessageId: LOG_MESSAGE,
          }),
        );
        return urls;
      }),
    );

    const onEntry = postedFiles(postedFilesOf(latest as never)).map(
      (f) => f.url,
    );
    expect(onEntry.sort()).toEqual(results.flat().sort());
    expect(onEntry).toHaveLength(2);
  });

  test("10 files on the entry fit; an 11th goes to a reply", async () => {
    const old = existingFiles(9);
    const proofs = [
      makeProof({
        attachments: old.map((f) => f.url),
        hostMessageId: LOG_MESSAGE,
      }),
    ];

    const fitting = v2Message(null, old);
    const one = setup({ posted: fitting, proofs });
    const fit = await one.service.hostProof(makeCase(), draft(), [
      upload("a.png"),
    ]);
    expect(fit).toMatchObject({ kind: "hosted", hostMessageId: LOG_MESSAGE });
    expect(fitting.reply).not.toHaveBeenCalled();
    expect(editPayload(fitting).attachments).toHaveLength(9);

    const full = v2Message(null, old);
    const two = setup({ posted: full, proofs });
    const over = await two.service.hostProof(makeCase(), draft(), [
      upload("a.png"),
      upload("b.png"),
    ]);
    expect(over).toMatchObject({ kind: "hosted", hostMessageId: LOG_REPLY });
    expect((over as { attachmentUrls: string[] }).attachmentUrls).toHaveLength(
      2,
    );
  });

  test("overflows at 4000 characters into a reply linked from the entry", async () => {
    const reason = "r".repeat(3000);
    const withReason = () =>
      new ModerationCase(
        GUILD,
        "4822",
        ActionType.Ban,
        new Date("2026-10-27T11:00:00.000Z"),
        TARGET,
        "spambot",
        EXECUTOR,
        Reason.create(reason).unwrap(),
        LOG_MESSAGE,
        [],
        DM,
      );

    // The entry without proof, plus what the draft's lines add, as hostProof measures it.
    const base = messageTextLength(await setup().service.render(withReason()));
    const meta = proofEntryText(
      {
        ...draft(),
        content: null,
        attachments: ["attachment://1_ticket.png"],
      },
      { lock: "", attachment: "" },
    );
    const longest =
      MESSAGE_TEXT_MAX_LENGTH -
      MORE_PROOF_LINE_RESERVE -
      DELETE_DM_PROMPT_RESERVE -
      base -
      (meta.length + 2);

    const fitting = v2Message(null);
    const fits = await setup({ posted: fitting }).service.hostProof(
      withReason(),
      draft({ content: "a".repeat(longest) }),
      [upload("ticket.png")],
    );
    expect(fits).toMatchObject({ kind: "hosted", hostMessageId: LOG_MESSAGE });
    expect(fitting.reply).not.toHaveBeenCalled();

    const full = v2Message(null);
    const over = await setup({ posted: full }).service.hostProof(
      withReason(),
      draft({ content: "a".repeat(longest + 1) }),
      [upload("ticket.png")],
    );
    expect(over).toMatchObject({ kind: "hosted", hostMessageId: LOG_REPLY });

    const reply = full.reply.mock.calls[0]?.[0] as unknown as {
      components: { toJSON(): unknown }[];
      files: { name: string }[];
      failIfNotExists: boolean;
    };
    expect(reply.failIfNotExists).toBe(false);
    expect(reply.files).toHaveLength(1);
    expect(payloadText(reply)).toContain(
      `More proof · Case #4822** · <@${TARGET}>`,
    );
    expect(payloadText(reply)).toContain("a".repeat(longest + 1));

    const entryEdit = payloadText(editPayload(full));
    expect(entryEdit).toContain(
      `-# More proof in the reply below: https://discord.com/channels/${GUILD}/${LOG_CHANNEL}/${LOG_REPLY}`,
    );
    expect(entryEdit).not.toContain("a".repeat(longest + 1));
    expect(entryEdit).toContain(reason);
  });

  test("non-media files get their link once Discord returns the URL", async () => {
    const posted = v2Message(null);
    const { service } = setup({ posted });

    const result = await service.hostProof(makeCase(), draft(), [
      upload("log.txt"),
    ]);

    const [url] = (result as unknown as { attachmentUrls: [string] })
      .attachmentUrls;
    expect(url).toMatch(/log\.txt\?ex=1&is=2&hm=3&$/);
    const edited = (await posted.edit.mock.results[0]?.value) as ReturnType<
      typeof fakeMessage
    >;
    expect(payloadText(editPayload(edited))).toContain(url);
  });
});

describe("ModLogMessageService.removeProof", () => {
  const BOT = "1";
  const SECOND_REPLY = "1029384756102938601";

  function gone(): DiscordAPIError {
    return new DiscordAPIError(
      { code: RESTJSONErrorCodes.UnknownMessage, message: "Unknown Message" },
      RESTJSONErrorCodes.UnknownMessage,
      404,
      "DELETE",
      "/channels/x/messages/y",
      {},
    );
  }

  test("drops the proof's files from the entry and keeps other proofs' files", async () => {
    const [mine, theirs] = existingFiles(2) as [FakeFile, FakeFile];
    const posted = v2Message(null, [mine, theirs]);
    const { service, removeRow, deleteMessage } = setup({
      posted,
      proofs: [
        makeProof({
          id: "1",
          attachments: [mine.url],
          hostMessageId: LOG_MESSAGE,
        }),
        makeProof({
          id: "2",
          attachments: [theirs.url],
          hostMessageId: LOG_MESSAGE,
        }),
      ],
    });

    expect(await service.removeProof(makeCase(), "1")).toBe("removed");

    const payload = editPayload(posted);
    expect(payload.attachments).toEqual([{ id: theirs.id }]);
    expect(payloadText(payload)).toContain(theirs.url);
    expect(payloadText(payload)).not.toContain(mine.url);
    expect(deleteMessage).not.toHaveBeenCalled();
    expect(removeRow).toHaveBeenCalledWith(GUILD, "1");
  });

  test("removes files left on the entry when the text moved to a reply", async () => {
    const [mine] = existingFiles(1) as [FakeFile];
    const posted = v2Message(null, [mine]);
    const { service, deleteMessage, removeRow } = setup({
      posted,
      proofs: [
        makeProof({
          id: "1",
          attachments: [mine.url],
          hostMessageId: LOG_REPLY,
        }),
      ],
    });

    expect(await service.removeProof(makeCase(), "1")).toBe("removed");

    expect(editPayload(posted).attachments).toEqual([]);
    expect(deleteMessage).toHaveBeenCalledWith(LOG_REPLY);
    expect(removeRow).toHaveBeenCalledWith(GUILD, "1");
  });

  test("deletes the whole reply chain, not only the stored first reply", async () => {
    const { service, deleteMessage } = setup({
      posted: v2Message(null),
      proofs: [makeProof({ id: "1", hostMessageId: LOG_REPLY })],
      later: [
        { id: SECOND_REPLY, authorId: BOT, replyTo: LOG_REPLY },
        { id: "1029384756102938602", authorId: BOT, replyTo: LOG_MESSAGE },
        { id: "1029384756102938603", authorId: MOD, replyTo: SECOND_REPLY },
      ],
    });

    expect(await service.removeProof(makeCase(), "1")).toBe("removed");

    expect(deleteMessage.mock.calls).toEqual([[SECOND_REPLY], [LOG_REPLY]]);
  });

  test("keeps the row when the entry edit fails, so undo can be retried", async () => {
    const posted = v2Message(null);
    posted.edit.mockImplementation(async () => {
      throw new Error("Discord down");
    });
    const { service, removeRow, deleteMessage } = setup({
      posted,
      proofs: [makeProof({ id: "1", hostMessageId: LOG_REPLY })],
    });

    expect(await service.removeProof(makeCase(), "1")).toBe("failed");

    expect(deleteMessage).not.toHaveBeenCalled();
    expect(removeRow).not.toHaveBeenCalled();
  });

  test("keeps the row when a reply can't be deleted", async () => {
    const { service, removeRow } = setup({
      posted: v2Message(null),
      proofs: [makeProof({ id: "1", hostMessageId: LOG_REPLY })],
      deleteMessage: mock(async () => {
        throw new Error("Discord down");
      }),
    });

    expect(await service.removeProof(makeCase(), "1")).toBe("failed");

    expect(removeRow).not.toHaveBeenCalled();
  });

  test("a reply someone already deleted doesn't fail the undo", async () => {
    const { service, removeRow } = setup({
      posted: v2Message(null),
      proofs: [makeProof({ id: "1", hostMessageId: LOG_REPLY })],
      deleteMessage: mock(async () => {
        throw gone();
      }),
    });

    expect(await service.removeProof(makeCase(), "1")).toBe("removed");

    expect(removeRow).toHaveBeenCalledWith(GUILD, "1");
  });

  test("a deleted entry still has its replies removed", async () => {
    const { service, removeRow, deleteMessage } = setup({
      current: () => {
        throw gone();
      },
      proofs: [makeProof({ id: "1", hostMessageId: LOG_REPLY })],
    });

    expect(await service.removeProof(makeCase(), "1")).toBe("removed");

    expect(deleteMessage).toHaveBeenCalledWith(LOG_REPLY);
    expect(removeRow).toHaveBeenCalledWith(GUILD, "1");
  });

  test("lost access to the entry removes nothing, since its files may still show", async () => {
    const { service, removeRow } = setup({
      fetchError: new DiscordAPIError(
        { code: RESTJSONErrorCodes.MissingAccess, message: "Missing Access" },
        RESTJSONErrorCodes.MissingAccess,
        403,
        "GET",
        "/channels/x/messages/y",
        {},
      ),
      proofs: [makeProof({ id: "1", hostMessageId: LOG_MESSAGE })],
    });

    expect(await service.removeProof(makeCase(), "1")).toBe("failed");

    expect(removeRow).not.toHaveBeenCalled();
  });

  test("lost access to a reply keeps the row", async () => {
    const { service, removeRow } = setup({
      posted: v2Message(null),
      proofs: [makeProof({ id: "1", hostMessageId: LOG_REPLY })],
      deleteMessage: mock(async () => {
        throw new DiscordAPIError(
          { code: RESTJSONErrorCodes.MissingAccess, message: "Missing Access" },
          RESTJSONErrorCodes.MissingAccess,
          403,
          "DELETE",
          "/channels/x/messages/y",
          {},
        );
      }),
    });

    expect(await service.removeProof(makeCase(), "1")).toBe("failed");

    expect(removeRow).not.toHaveBeenCalled();
  });

  test("an entry deleted with its files touches nothing else in the channel", async () => {
    const [mine] = existingFiles(1) as [FakeFile];
    const { service, removeRow, deleteMessage } = setup({
      current: () => {
        throw gone();
      },
      proofs: [
        makeProof({
          id: "1",
          attachments: [mine.url],
          hostMessageId: LOG_MESSAGE,
        }),
      ],
      later: [{ id: LOG_REPLY, authorId: BOT, replyTo: LOG_MESSAGE }],
    });

    expect(await service.removeProof(makeCase(), "1")).toBe("removed");

    expect(deleteMessage).not.toHaveBeenCalled();
    expect(removeRow).toHaveBeenCalledWith(GUILD, "1");
  });

  test("files in another channel mean the mod log moved, so nothing is removed", async () => {
    const { service, removeRow, deleteMessage } = setup({
      current: () => {
        throw gone();
      },
      proofs: [
        makeProof({
          id: "1",
          attachments: [
            "https://cdn.discordapp.com/attachments/999/888/a.png?ex=1&is=2&hm=3&",
          ],
          hostMessageId: LOG_MESSAGE,
        }),
      ],
    });

    expect(await service.removeProof(makeCase(), "1")).toBe("failed");

    expect(deleteMessage).not.toHaveBeenCalled();
    expect(removeRow).not.toHaveBeenCalled();
  });

  test("a mod log that's off fails instead of guessing", async () => {
    const { service, removeRow, deleteMessage } = setup({
      modLogChannel: null,
      proofs: [makeProof({ id: "1", hostMessageId: LOG_MESSAGE })],
    });

    expect(await service.removeProof(makeCase(), "1")).toBe("failed");

    expect(deleteMessage).not.toHaveBeenCalled();
    expect(removeRow).not.toHaveBeenCalled();
  });

  test("proof that never reached Discord only needs its row removed", async () => {
    const { service, removeRow } = setup({
      modLogChannel: null,
      proofs: [makeProof({ id: "1" })],
    });

    expect(await service.removeProof(makeCase(), "1")).toBe("removed");

    expect(removeRow).toHaveBeenCalledWith(GUILD, "1");
  });

  test("renders again after the row is gone, in case a refresh restored the proof", async () => {
    const posted = v2Message(null);
    const proofs = [
      makeProof({
        id: "1",
        content: "Same scam DMs",
        hostMessageId: LOG_MESSAGE,
      }),
    ];
    const { service, removeRow, listByCase } = setup({ posted, proofs });
    removeRow.mockImplementation(async () => {
      listByCase.mockImplementation(async () => []);
      return null;
    });

    await service.removeProof(makeCase(), "1");

    expect(posted.edit).toHaveBeenCalledTimes(2);
    expect(payloadText(editPayload(posted, 1))).not.toContain("Same scam DMs");
  });

  test("a temporary fetch failure removes nothing", async () => {
    const { service, removeRow } = setup({
      fetchError: new Error("timeout"),
      proofs: [makeProof({ id: "1", hostMessageId: LOG_MESSAGE })],
    });

    expect(await service.removeProof(makeCase(), "1")).toBe("failed");

    expect(removeRow).not.toHaveBeenCalled();
  });

  test("a proof already removed doesn't touch the entry", async () => {
    const posted = v2Message(null);
    const { service, removeRow } = setup({ posted, proofs: [] });

    expect(await service.removeProof(makeCase(), "1")).toBe("already_removed");

    expect(posted.edit).not.toHaveBeenCalled();
    expect(removeRow).not.toHaveBeenCalled();
  });
});

describe("ModLogMessageService adopting unhosted proof files", () => {
  const RESPONSE_URL =
    "https://cdn.discordapp.com/attachments/9/8/dm-screenshot.png?ex=1&is=2&hm=3&";
  const fetchSpy = spyOn(globalThis, "fetch");

  afterEach(() => {
    fetchSpy.mockReset();
  });

  test("adoption re-uploads a response-hosted file onto the entry; refresh never downloads", async () => {
    fetchSpy.mockResolvedValue(
      new Response(Buffer.from("png"), {
        headers: { "content-type": "image/png" },
      }),
    );
    const posted = v2Message(null);
    const { service, updateHosting } = setup({
      posted,
      proofs: [
        makeProof({ id: "7", source: "action", attachments: [RESPONSE_URL] }),
        makeProof({ id: "8", source: "backfill", attachments: [RESPONSE_URL] }),
      ],
    });

    expect(await service.refresh(makeCase())).toBe("updated");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(editPayload(posted).files).toBeUndefined();

    await service.adoptUnhosted(makeCase());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const upload = editPayload(posted, 1);
    expect(upload.files?.map((f) => f.name)).toEqual(["1_dm-screenshot.png"]);
    expect(updateHosting).toHaveBeenCalledWith(GUILD, "7", {
      attachments: [expect.stringContaining("/1_dm-screenshot.png?ex=")],
      hostMessageId: LOG_MESSAGE,
    });
    expect(updateHosting).toHaveBeenCalledTimes(1);
  });

  test("nothing adoptable: no entry fetch at all", async () => {
    const { service, client } = setup({
      proofs: [
        makeProof({
          id: "7",
          hostMessageId: LOG_MESSAGE,
          attachments: [RESPONSE_URL],
        }),
        makeProof({ id: "8", source: "backfill", attachments: [RESPONSE_URL] }),
      ],
    });

    await service.adoptUnhosted(makeCase());

    expect(client.channels.fetch).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a file Discord no longer serves stays listed and isn't fetched again", async () => {
    const gone = RESPONSE_URL.replace("dm-", "gone-");
    const kept = RESPONSE_URL.replace("dm-", "kept-");
    fetchSpy.mockImplementation((async (url: string | URL | Request) =>
      String(url) === gone
        ? new Response("gone", { status: 404 })
        : new Response(Buffer.from("png"))) as unknown as typeof fetch);
    const posted = v2Message(null);
    const { service, updateHosting } = setup({
      posted,
      proofs: [makeProof({ id: "7", source: "action", attachments: [gone] })],
    });

    await service.adoptUnhosted(makeCase());
    await service.adoptUnhosted(makeCase());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(updateHosting).not.toHaveBeenCalled();
    expect(posted.edit).not.toHaveBeenCalled();

    // With a live file next to it, the gone one stays in the row.
    const partly = setup({
      proofs: [
        makeProof({ id: "8", source: "action", attachments: [kept, gone] }),
      ],
    });
    await partly.service.adoptUnhosted(makeCase());
    expect(partly.updateHosting).toHaveBeenCalledWith(GUILD, "8", {
      attachments: [
        expect.stringContaining("/1_kept-screenshot.png?ex="),
        gone,
      ],
      hostMessageId: LOG_MESSAGE,
    });
  });

  test("403 is worth retrying", async () => {
    const forbidden = RESPONSE_URL.replace("dm-", "forbidden-");
    fetchSpy.mockResolvedValue(new Response("", { status: 403 }));
    const { service, updateHosting } = setup({
      proofs: [
        makeProof({ id: "7", source: "action", attachments: [forbidden] }),
      ],
    });

    await service.adoptUnhosted(makeCase());
    await service.adoptUnhosted(makeCase());

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(updateHosting).not.toHaveBeenCalled();
  });

  test("a download that may work later leaves the proof for the next try", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(Buffer.from("png")));
    fetchSpy.mockResolvedValueOnce(new Response("busy", { status: 503 }));
    const posted = v2Message(null);
    const { service, updateHosting } = setup({
      posted,
      proofs: [
        makeProof({
          id: "7",
          source: "action",
          attachments: [RESPONSE_URL, RESPONSE_URL.replace("dm-", "b-")],
        }),
      ],
    });

    await service.adoptUnhosted(makeCase());

    expect(updateHosting).not.toHaveBeenCalled();
    expect(posted.edit).not.toHaveBeenCalled();
  });

  test("files over the size cap and other hosts stay where they are", async () => {
    fetchSpy.mockResolvedValue(
      new Response("x", {
        headers: { "content-length": String(50 * 1024 * 1024) },
      }),
    );
    const { service, updateHosting } = setup({
      proofs: [
        makeProof({
          id: "7",
          source: "action",
          attachments: [RESPONSE_URL, "https://example.com/a.png"],
        }),
      ],
    });

    await service.adoptUnhosted(makeCase());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(updateHosting).not.toHaveBeenCalled();
  });

  test("postEntry returns once sent; the files follow in the background", async () => {
    let finish: (response: Response) => void = () => undefined;
    fetchSpy.mockImplementation(
      (() =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })) as unknown as typeof fetch,
    );
    let sentMessage: ReturnType<typeof fakeMessage> | null = null;
    const send = mock(async (payload: never) => {
      expect(fetchSpy).not.toHaveBeenCalled();
      sentMessage = postedFrom(payload, LOG_MESSAGE);
      return sentMessage;
    });
    const { service, updateHosting } = setup({
      proofs: [
        makeProof({ id: "7", source: "action", attachments: [RESPONSE_URL] }),
      ],
    });

    // The download never finishes until released below, so this only resolves if adoption is detached.
    const sent = await service.postEntry(
      { send } as never,
      makeCase({ msgId: null, pending: true }),
    );

    expect(sent.id).toBe(LOG_MESSAGE);
    const payload = send.mock.calls[0]?.[0] as unknown as {
      files?: unknown[];
    };
    expect(payload.files).toBeUndefined();
    expect(updateHosting).not.toHaveBeenCalled();

    await waitFor(() => fetchSpy.mock.calls.length > 0);
    finish(new Response(Buffer.from("png")));
    await waitFor(() => updateHosting.mock.calls.length > 0);

    const upload = editPayload(sentMessage as never);
    expect(upload.files?.map((f) => f.name)).toEqual(["1_dm-screenshot.png"]);
    expect(updateHosting).toHaveBeenCalledWith(GUILD, "7", {
      attachments: [expect.stringContaining("/1_dm-screenshot.png?ex=")],
      hostMessageId: LOG_MESSAGE,
    });
  });
});

describe("ModLogMessageService oversized proof", () => {
  const huge = () =>
    draft({
      content: "c".repeat(1000),
      sourceAuthorId: TARGET,
      sourceContent: "a\n".repeat(1000),
      sourceMessageUrl: `https://discord.com/channels/${GUILD}/1/2`,
    });

  function partTexts(payload: { components: { toJSON(): unknown }[] }) {
    const container = payload.components[0]?.toJSON() as {
      components: { type: number; content?: string }[];
    };
    return container.components
      .filter((c) => c.type === 10)
      .map((c) => c.content ?? "");
  }

  test("a proof too long for one message is split across replies, never cut", async () => {
    const posted = v2Message(null);
    const { service } = setup({ posted });

    const result = await service.hostProof(makeCase(), huge(), [
      upload("shot.png"),
    ]);

    expect(result).toMatchObject({ kind: "hosted", hostMessageId: LOG_REPLY });
    const first = (await posted.reply.mock.results[0]?.value) as ReturnType<
      typeof fakeMessage
    >;
    const payloads = [
      posted.reply.mock.calls[0]?.[0],
      first.reply.mock.calls[0]?.[0],
    ] as unknown as {
      components: { toJSON(): unknown }[];
      files: { name: string }[];
    }[];
    expect(payloads.every(Boolean)).toBe(true);
    expect(payloads[0]?.files).toEqual([]);
    expect(payloads[1]?.files).toHaveLength(1);

    const texts = payloads.map(partTexts);
    for (const parts of texts) {
      expect(parts.reduce((sum, t) => sum + t.length, 0)).toBeLessThanOrEqual(
        4000,
      );
      expect(parts[0]).toContain("More proof · Case #4822");
    }
    expect(texts[0]?.[0]).toContain("part 1 of 2");
    const body = texts.map((parts) => parts[1]).join("\n");
    expect(body).toBe(
      proofEntryText(
        {
          ...huge(),
          attachments: ["attachment://1_shot.png"],
        },
        { lock: "", attachment: "" },
      ),
    );

    expect(payloadText(editPayload(posted))).toContain(
      `More proof in the reply below: https://discord.com/channels/${GUILD}/${LOG_CHANNEL}/${LOG_REPLY}`,
    );
  });

  test("unhosted text too long for the entry renders without it, then refresh moves it to replies", async () => {
    const proofs = [makeProof({ ...huge(), id: "9", hostMessageId: null })];
    const posted = v2Message(null);
    const { service, updateHosting } = setup({ posted, proofs });

    const rendered = text(await service.render(makeCase()));
    expect(rendered).not.toContain("c".repeat(1000));

    expect(await service.refresh(makeCase())).toBe("updated");
    expect(posted.reply).toHaveBeenCalledTimes(1);
    expect(updateHosting).toHaveBeenCalledWith(GUILD, "9", {
      attachments: [],
      hostMessageId: LOG_REPLY,
    });
  });
});

describe("ModLogMessageService keeping the entry within limits", () => {
  test("a reason edited after proof moves proof that no longer fits into replies", async () => {
    const proofs = ["x", "y", "z"].map((c, i) =>
      makeProof({
        id: String(i + 1),
        content: c.repeat(i === 0 ? 200 : 1000),
        hostMessageId: LOG_MESSAGE,
      }),
    );
    const posted = v2Message(null);
    const { service, updateHosting } = setup({ posted, proofs });
    const withReason = (reason: string) =>
      new ModerationCase(
        GUILD,
        "4822",
        ActionType.Ban,
        new Date("2026-10-27T11:00:00.000Z"),
        TARGET,
        "spambot",
        EXECUTOR,
        Reason.create(reason).unwrap(),
        LOG_MESSAGE,
        [],
        DM,
      );

    expect(await service.refresh(withReason("short"))).toBe("updated");
    expect(posted.reply).not.toHaveBeenCalled();

    expect(await service.refresh(withReason("r".repeat(3000)))).toBe("updated");

    // Newest first until it fits; the oldest, short one stays.
    expect(updateHosting).toHaveBeenCalledTimes(2);
    expect(updateHosting).toHaveBeenCalledWith(GUILD, "2", {
      attachments: [],
      hostMessageId: LOG_REPLY,
    });
    expect(updateHosting).toHaveBeenCalledWith(GUILD, "3", {
      attachments: [],
      hostMessageId: LOG_REPLY,
    });
    const entry = editPayload(posted, 1);
    expect(messageTextLength(entry)).toBeLessThanOrEqual(4000);
    expect(payloadText(entry)).toContain("r".repeat(3000));
    expect(payloadText(entry)).toContain("x".repeat(200));
    expect(payloadText(entry)).not.toContain("y".repeat(1000));
    expect(payloadText(entry)).toContain("More proof in the reply below");
    const replies = posted.reply.mock.calls.map((call) =>
      payloadText(call[0] as never),
    );
    expect(replies[0]).toContain("y".repeat(1000));
    expect(replies[1]).toContain("z".repeat(1000));
  });

  test("a legacy embed entry is converted before it gets files", async () => {
    const legacy = legacyMessage([]);
    const converted = v2Message(null);
    const withFetch = Object.assign(legacy, {
      fetch: mock(async () => converted),
    });
    const { service, patch } = setup({ posted: withFetch });

    const result = await service.hostProof(makeCase(), draft(), [
      upload("shot.png"),
    ]);

    expect(patch).toHaveBeenCalledTimes(1);
    expect(withFetch.fetch).toHaveBeenCalledWith(true);
    expect(legacy.edit).not.toHaveBeenCalled();
    expect(editPayload(converted).files?.map((f) => f.name)).toEqual([
      "1_shot.png",
    ]);
    expect(result).toMatchObject({
      kind: "hosted",
      hostMessageId: LOG_MESSAGE,
    });
  });

  test("a reply that fails partway deletes the parts already posted", async () => {
    const posted = v2Message(null);
    const first = fakeMessage(LOG_REPLY, []);
    first.reply.mockRejectedValueOnce(new Error("Missing Permissions"));
    posted.reply.mockResolvedValueOnce(first as never);
    const { service } = setup({ posted });

    await expect(
      service.hostProof(
        makeCase(),
        draft({
          content: "c".repeat(1000),
          sourceContent: "a\n".repeat(1000),
        }),
        [],
      ),
    ).rejects.toThrow("Failed to post proof replies");
    expect(first.delete).toHaveBeenCalledTimes(1);
  });
});

function caseWith(
  o: { reason?: string; msgId?: string | null; actionTime?: Date } = {},
) {
  return new ModerationCase(
    GUILD,
    "4822",
    ActionType.Ban,
    o.actionTime ?? new Date("2026-10-27T11:00:00.000Z"),
    TARGET,
    "spambot",
    EXECUTOR,
    o.reason ? Reason.create(o.reason).unwrap() : null,
    o.msgId === undefined ? LOG_MESSAGE : o.msgId,
    [],
    DM,
  );
}

function fullEntryProofs(): CaseProof[] {
  return ["y", "z"].map((c, i) =>
    makeProof({
      id: String(i + 1),
      content: c.repeat(1000),
      hostMessageId: LOG_MESSAGE,
    }),
  );
}

function lockOf(service: ModLogMessageService): KeyedMutex {
  return (service as unknown as { caseLock: KeyedMutex }).caseLock;
}

describe("ModLogMessageService without waiting on the case lock", () => {
  test("render() of the posted entry moves proof that no longer fits", async () => {
    const posted = v2Message(null);
    const { service, updateHosting } = setup({
      posted,
      proofs: fullEntryProofs(),
    });

    const message = await service.render(
      caseWith({ reason: "r".repeat(3000) }),
      {
        currentMessage: posted as never,
      },
    );

    expect(posted.reply).toHaveBeenCalled();
    expect(updateHosting).toHaveBeenCalled();
    expect(messageTextLength(message)).toBeLessThanOrEqual(4000);
    expect(text(message)).toContain("More proof in the reply below");
  });

  test("a failed move leaves the entry alone instead of hiding proof", async () => {
    const posted = v2Message(null);
    posted.reply.mockRejectedValue(new Error("Missing Permissions"));
    const { service, updateHosting } = setup({
      posted,
      proofs: fullEntryProofs(),
    });
    const edited = caseWith({ reason: "r".repeat(3000) });

    await expect(
      service.render(edited, { currentMessage: posted as never }),
    ).rejects.toThrow("couldn't be moved");
    expect(
      await service.refreshEntry(
        { message: posted as never, missing: null },
        edited,
      ),
    ).toBe("failed");
    expect(posted.edit).not.toHaveBeenCalled();
    expect(updateHosting).not.toHaveBeenCalled();
  });

  test("a busy case skips the move and returns at once", async () => {
    const posted = v2Message(null);
    const { service } = setup({ posted, proofs: fullEntryProofs() });
    let release: () => void = () => undefined;
    const held = lockOf(service).run(
      `${GUILD}:4822`,
      () => new Promise<void>((resolve) => (release = resolve)),
    );

    expect(
      await service.refreshEntry(
        { message: posted as never, missing: null },
        caseWith({ reason: "r".repeat(3000) }),
      ),
    ).toBe("failed");
    expect(posted.reply).not.toHaveBeenCalled();
    expect(posted.edit).not.toHaveBeenCalled();

    // A plain edit doesn't need the lock at all.
    expect(await service.refresh(caseWith({ reason: "short" }))).toBe(
      "updated",
    );
    release();
    await held;
  });

  test("a slow adoption download doesn't hold up a refresh", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");
    let finish: (response: Response) => void = () => undefined;
    fetchSpy.mockImplementation(
      (() =>
        new Promise<Response>(
          (resolve) => (finish = resolve),
        )) as unknown as typeof fetch,
    );
    const posted = v2Message(null);
    const { service } = setup({
      posted,
      proofs: [
        makeProof({
          id: "7",
          source: "action",
          attachments: [
            "https://cdn.discordapp.com/attachments/9/8/slow.png?ex=1&is=2&hm=3&",
          ],
        }),
      ],
    });

    const adoption = service.adoptUnhosted(caseWith());
    await sleep(5);
    expect(await service.refresh(caseWith({ reason: "edited" }))).toBe(
      "updated",
    );
    await service.render(caseWith({ reason: "edited" }), {
      currentMessage: posted as never,
    });

    finish(new Response(Buffer.from("png")));
    await adoption;
    fetchSpy.mockReset();
    expect(posted.edit.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("ModLogMessageService waiting for an entry being posted", () => {
  test("a fresh case with no message ID yet is waited for", async () => {
    const posting = caseWith({ msgId: null, actionTime: new Date() });
    const findById = mock(async () => posting);
    findById.mockResolvedValueOnce(posting);
    findById.mockResolvedValueOnce(caseWith({ actionTime: new Date() }));
    const { service } = setup({ findById });

    expect(
      await service.hostProof(posting, draft(), [upload("a.png")]),
    ).toMatchObject({ kind: "hosted", hostMessageId: LOG_MESSAGE });
    expect(findById).toHaveBeenCalledTimes(2);
  });

  test("an old case that never got an entry has no mod log to use", async () => {
    const findById = mock(async () => null);
    const { service } = setup({ findById });

    expect(
      await service.hostProof(caseWith({ msgId: null }), draft(), [
        upload("a.png"),
      ]),
    ).toEqual({ kind: "no_mod_log" });
    expect(findById).not.toHaveBeenCalled();
  });

  test("a deleted entry has no mod log to use; a flaky fetch retries later", async () => {
    const gone = setup({
      fetchError: new DiscordAPIError(
        { code: RESTJSONErrorCodes.UnknownMessage, message: "Unknown Message" },
        RESTJSONErrorCodes.UnknownMessage,
        404,
        "GET",
        "/channels/1/messages/2",
        {},
      ),
    });
    expect(
      await gone.service.hostProof(caseWith(), draft(), [upload("a.png")]),
    ).toEqual({ kind: "no_mod_log" });

    const flaky = setup({ fetchError: new Error("socket hang up") });
    expect(
      await flaky.service.hostProof(caseWith(), draft(), [upload("a.png")]),
    ).toEqual({ kind: "retry_later" });
  });
});
