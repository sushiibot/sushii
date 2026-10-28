import { sleep } from "bun";
import { describe, expect, mock, test } from "bun:test";
import { ComponentType, MessageFlags } from "discord.js";
import pino from "pino";
import { Err, Ok } from "ts-results";

import type { ReasonTemplate } from "@/features/moderation/reason-templates/domain/ReasonTemplate";
import type { ParsedReasonFields } from "@/features/moderation/shared/presentation/reasonFields";

import { buildModerationActionModal } from "./moderationActionModal";
import {
  type ReasonFormEmojis,
  type ReasonFormFollowUpDeps,
  ReasonFormRetryStore,
  buildRetryMatcher,
  captureModalValues,
  completeReasonForm,
  prefillModal,
  tooLongMessage,
} from "./reasonFormSubmit";

const GUILD = "187450744427773963";
const MOD = "150443906511667200";

const TEMPLATE: ReasonTemplate = {
  id: "16",
  guildId: GUILD,
  shortcut: null,
  content: "Arguing with mods.",
  contentKey: "k",
  createdBy: MOD,
  createdAt: new Date(),
  updatedAt: null,
  useCount: 0,
  lastUsedAt: null,
};

const emojis: ReasonFormEmojis = {
  history: "<:history:1400000000000000200>",
  success: "<:success:1400000000000000201>",
  message_edit: "<:message_edit:1400000000000000202>",
  fail: "<:fail:1400000000000000203>",
};

function parsed(
  overrides: Partial<ParsedReasonFields> = {},
): ParsedReasonFields {
  return {
    text: "Arguing with mods.",
    template: null,
    unknownShortcut: null,
    unresolved: null,
    saveAsTemplate: false,
    updateDm: false,
    ...overrides,
  };
}

function deps() {
  const d = {
    reasonTemplateService: {
      recordUse: mock(async () => undefined),
      create: mock(async () => Ok(TEMPLATE)),
    },
    emojiRepository: { getEmojis: mock(async () => emojis) },
    logger: pino({ level: "silent" }),
  };
  return d as typeof d & ReasonFormFollowUpDeps;
}

describe("tooLongMessage", () => {
  test("names the overage", () => {
    expect(tooLongMessage({ code: "too_long", length: 3042, max: 3000 })).toBe(
      "**Nothing was done.** The reason is 3,042 characters after adding the template; the limit is 3,000. Shorten the details by 42 characters.",
    );
  });
});

describe("completeReasonForm", () => {
  test("records the template used", async () => {
    const d = deps();
    const followUp = mock(async () => undefined);

    await completeReasonForm({ followUp }, d, {
      guildId: GUILD,
      userId: MOD,
      parsed: parsed({ template: { id: "11", shortcut: "spam" } }),
      emojis,
    });

    expect(d.reasonTemplateService.recordUse).toHaveBeenCalledWith(GUILD, "11");
    expect(followUp).not.toHaveBeenCalled();
  });

  test("saves when ticked and confirms with Edit template", async () => {
    const d = deps();
    const followUp = mock(async () => undefined);

    await completeReasonForm({ followUp }, d, {
      guildId: GUILD,
      userId: MOD,
      parsed: parsed({ saveAsTemplate: true }),
      emojis,
    });

    expect(d.reasonTemplateService.create).toHaveBeenCalledWith(
      GUILD,
      {
        content: "Arguing with mods.",
        shortcut: null,
        createdBy: MOD,
      },
      "checkbox",
    );
    const [message] = followUp.mock.calls[0] as unknown as [
      { flags: number; components: { toJSON(): unknown }[] },
    ];
    expect(message.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
    expect(JSON.stringify(message.components[0]?.toJSON())).toContain(
      "Edit template",
    );
  });

  test("limit reached is a private note, not an error", async () => {
    const d = deps();
    d.reasonTemplateService.create.mockResolvedValueOnce(
      Err({ code: "limit_reached", limit: 100 }) as never,
    );
    const followUp = mock(async () => undefined);

    await completeReasonForm({ followUp }, d, {
      guildId: GUILD,
      userId: MOD,
      parsed: parsed({ saveAsTemplate: true }),
      emojis,
    });

    expect(followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("100 templates, the maximum"),
        flags: MessageFlags.Ephemeral,
      }),
    );
  });

  test("notes an unknown shortcut", async () => {
    const followUp = mock(async () => undefined);

    await completeReasonForm({ followUp }, deps(), {
      guildId: GUILD,
      userId: MOD,
      parsed: parsed({ unknownShortcut: "spma" }),
      emojis,
    });

    expect(followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("No template `!spma`"),
      }),
    );
  });
});

describe("prefillModal", () => {
  test("restores typed text, picks and checkboxes", () => {
    const modal = buildModerationActionModal({
      actionType: "timeout",
      customId: "cid",
      targetName: "spambot",
      formData: { last: null, templates: [TEMPLATE] },
      emojis,
    }).toJSON();

    const values = captureModalValues({
      fields: new Map<string, unknown>([
        ["duration", { customId: "duration", values: ["1d"] }],
        [
          "reason_template",
          { customId: "reason_template", values: ["template:16"] },
        ],
        ["reason", { customId: "reason", value: "extra details" }],
        ["save_as_template", { customId: "save_as_template", value: true }],
      ]) as never,
    });
    const filled = prefillModal(modal, values);

    const byId = Object.fromEntries(
      filled.components.map((c) => {
        const label = c as unknown as {
          type: number;
          component: Record<string, unknown>;
        };
        expect(label.type).toBe(ComponentType.Label);
        return [label.component.custom_id, label.component];
      }),
    );
    const defaults = (id: string) =>
      (byId[id]?.options as { value: string; default?: boolean }[])
        .filter((o) => o.default)
        .map((o) => o.value);

    expect(defaults("duration")).toEqual(["1d"]);
    expect(defaults("reason_template")).toEqual(["template:16"]);
    expect(byId.reason?.value).toBe("extra details");
    expect(byId.save_as_template?.default).toBe(true);
  });
});

describe("ReasonFormRetryStore", () => {
  test("entries expire after the TTL", async () => {
    const store = new ReasonFormRetryStore<string>(20);
    const token = store.put(MOD, "form");

    expect(store.claim(token, MOD)).toBe("form");
    await sleep(40);
    expect(store.claim(token, MOD)).toBe("expired");
  });

  test("only the user who got the error can use Try again", () => {
    const store = new ReasonFormRetryStore<string>();
    const token = store.put(MOD, "form");

    expect(store.claim(token, "238381427315195904")).toBe("wrong_user");
    expect(store.claim(token, MOD)).toBe("form");
  });

  test("evicts the oldest entry past the cap", () => {
    const store = new ReasonFormRetryStore<string>(60_000, 2);
    const first = store.put(MOD, "a");
    store.put(MOD, "b");
    store.put(MOD, "c");

    expect(store.size).toBe(2);
    expect(store.claim(first, MOD)).toBe("expired");
  });

  test("retry ids round-trip and stay within Discord's limit", () => {
    const ids = buildRetryMatcher("automodAlert/retry");
    const token = new ReasonFormRetryStore<string>().put(MOD, "x");
    const customId = ids.build(token);

    expect(customId.length).toBeLessThanOrEqual(100);
    expect(ids.parse(customId)).toBe(token);
    expect(ids.parse("screening/retry/abc")).toBeNull();
  });
});
