import { describe, expect, test } from "bun:test";

import {
  GUILD,
  MOD,
  TARGET,
  TARGET_3,
  botEmoji,
  makeCase,
} from "@/features/moderation/actions/presentation/response/testFixtures";
import type { CaseProof } from "@/features/moderation/shared/domain/entities/CaseProof";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";

import {
  ADD_AS_PROOF_EMOJIS,
  type AddAsProofEmojis,
  SOURCE_CONTENT_MAX_LENGTH,
  SOURCE_SHORTENED_LINE,
  type SourceMessage,
  buildAddAsProofCustomId,
  buildAddAsProofDone,
  buildAddAsProofPicker,
  parseAddAsProofCustomId,
  proofSourceContent,
} from "./AddAsProofView";

const CHANNEL = "1029384756102938401";
const MESSAGE = "1029384756102938499";
const NOW = new Date("2026-10-27T13:00:00.000Z");

const emojis = Object.fromEntries(
  ADD_AS_PROOF_EMOJIS.map((n) => [n, botEmoji(n)]),
) as AddAsProofEmojis;

function message(overrides: Partial<SourceMessage> = {}): SourceMessage {
  return {
    id: MESSAGE,
    channelId: CHANNEL,
    url: `https://discord.com/channels/${GUILD}/${CHANNEL}/${MESSAGE}`,
    authorId: TARGET,
    content: "I'm giving away free nitro, claim here",
    files: [{ contentType: "image/png" }],
    forwarded: false,
    ...overrides,
  };
}

function json(payload: { components?: readonly unknown[] }) {
  return JSON.stringify(
    (payload.components ?? []).map((c) =>
      (c as { toJSON(): unknown }).toJSON(),
    ),
  );
}

describe("Add as proof custom ids", () => {
  test("round-trip and fit 100 characters", () => {
    const ids = [
      {
        kind: "add" as const,
        caseId: "999999999999999999",
        channelId: "12345678901234567890",
        messageId: "12345678901234567890",
      },
      { kind: "pick" as const, channelId: CHANNEL, messageId: MESSAGE },
      { kind: "user" as const, channelId: CHANNEL, messageId: MESSAGE },
    ];
    for (const id of ids) {
      const customId = buildAddAsProofCustomId(id);
      expect(customId.length).toBeLessThanOrEqual(100);
      expect(parseAddAsProofCustomId(customId)).toEqual(id);
    }
  });

  test("rejects other and malformed ids", () => {
    for (const customId of [
      "caseProof/add/4822",
      `proof/ctx/add/${CHANNEL}/${MESSAGE}`,
      `proof/ctx/add/${CHANNEL}/${MESSAGE}/abc`,
      `proof/ctx/pick/${CHANNEL}/${MESSAGE}/4822`,
      `proof/ctx/pick/${CHANNEL}`,
      `proof/ctx/user/x/${MESSAGE}`,
      `proof/ctx/other/${CHANNEL}/${MESSAGE}`,
    ]) {
      expect(parseAddAsProofCustomId(customId)).toBeNull();
    }
  });
});

describe("proofSourceContent", () => {
  test("collapses runs of blank lines to one blank line", () => {
    expect(proofSourceContent("a\n\n\n\nb\r\n\r\n\r\nc\n \n\t\nd\n\ne")).toBe(
      "a\n\nb\n\nc\n\nd\n\ne",
    );
  });

  test("an image-only message stores no text", () => {
    expect(proofSourceContent("")).toBeNull();
    expect(proofSourceContent(" \n\n ")).toBeNull();
  });

  test("text up to the cap is stored whole, without the shortened line", () => {
    const text = "x".repeat(SOURCE_CONTENT_MAX_LENGTH);
    expect(proofSourceContent(text)).toBe(text);
    // Collapsing alone isn't a cut.
    const collapsed = proofSourceContent(`${"y".repeat(1400)}\n\n\n\n\nz`);
    expect(collapsed).not.toContain(SOURCE_SHORTENED_LINE);
  });

  test("longer text is cut to the cap and says so", () => {
    const stored = proofSourceContent("word ".repeat(400)) ?? "";
    expect(stored.length).toBeLessThanOrEqual(SOURCE_CONTENT_MAX_LENGTH);
    expect(stored.endsWith(`…\n${SOURCE_SHORTENED_LINE}`)).toBe(true);
  });

  test("never splits a surrogate pair", () => {
    const stored = proofSourceContent("😀".repeat(1000)) ?? "";
    expect(stored.length).toBeLessThanOrEqual(SOURCE_CONTENT_MAX_LENGTH);
    expect(stored).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe("proofSourceContent for a forward", () => {
  test("names the forwarder first", () => {
    expect(proofSourceContent("scam", { forwardedBy: TARGET })).toBe(
      `Forwarded by <@${TARGET}>\nscam`,
    );
    expect(proofSourceContent("", { forwardedBy: TARGET })).toBe(
      `Forwarded by <@${TARGET}>`,
    );
  });

  test("the forwarder line counts inside the cap", () => {
    const stored =
      proofSourceContent("x".repeat(1495), { forwardedBy: TARGET }) ?? "";
    expect(stored.length).toBeLessThanOrEqual(SOURCE_CONTENT_MAX_LENGTH);
    expect(stored.startsWith(`Forwarded by <@${TARGET}>\n`)).toBe(true);
    expect(stored.endsWith(SOURCE_SHORTENED_LINE)).toBe(true);
  });
});

describe("Add as proof picker", () => {
  const cases = [
    makeCase({ caseId: "4822" }),
    makeCase({
      caseId: "4801",
      actionType: ActionType.Warn,
      reason: "Posting invite links",
    }),
    makeCase({ caseId: "4790", actionType: ActionType.Note }),
  ];

  test("several cases: newest is a button, the rest a select, then the user select", () => {
    const payload = buildAddAsProofPicker({
      message: message(),
      user: { id: TARGET, username: "spambot" },
      showing: "author",
      cases,
      emojis,
      now: NOW,
    });
    const out = json(payload);

    expect(out).toContain("**Add this message as proof**");
    expect(out).toContain("> I'm giving away free nitro, claim here");
    expect(out).toContain(`-# From <@${TARGET}> in <#${CHANNEL}> · 1 image`);
    expect(out).toContain("Add to #4822 · Ban · 2 hours ago");
    expect(out).toContain(`proof/ctx/add/${CHANNEL}/${MESSAGE}/4822`);
    expect(out).toContain("Or another of spambot's cases…");
    expect(out).toContain('"value":"4801"');
    expect(out).toContain('"value":"4790"');
    expect(out).not.toContain('"value":"4822"');
    expect(out).toContain("Someone else's case…");
    expect(out).not.toContain("Showing");
    expect(out).toContain(
      "-# Left the server? Use `/proof` with their case number.",
    );
    expect(payload.allowedMentions).toEqual({ parse: [] });
  });

  test("one case: only the button and the user select", () => {
    const out = json(
      buildAddAsProofPicker({
        message: message(),
        user: { id: TARGET, username: "spambot" },
        showing: "author",
        cases: [cases[0]],
        emojis,
        now: NOW,
      }),
    );

    expect(out).toContain("Add to #4822");
    expect(out).not.toContain("Or another of");
    expect(out).toContain("Someone else's case…");
  });

  test("someone else picked: says whose cases and keeps them selected", () => {
    const out = json(
      buildAddAsProofPicker({
        message: message(),
        user: { id: TARGET_3, username: "raider_99" },
        showing: "other",
        cases: [makeCase({ caseId: "4824", userId: TARGET_3 })],
        emojis,
        now: NOW,
      }),
    );

    expect(out).toContain(`-# Showing <@${TARGET_3}>'s cases`);
    expect(out).toContain("Add to #4824");
    expect(out).toContain(
      `"default_values":[{"id":"${TARGET_3}","type":"user"}]`,
    );
  });

  test("no cases: only the user select and a /note hint", () => {
    const out = json(
      buildAddAsProofPicker({
        message: message({ files: [] }),
        user: { id: TARGET, username: "spambot" },
        showing: "author",
        cases: [],
        emojis,
        now: NOW,
      }),
    );

    expect(out).toContain(
      `-# <@${TARGET}> has no cases. Pick whose case this is for, or use \`/note\` to keep a note about them.`,
    );
    expect(out).toContain(`-# From <@${TARGET}> in <#${CHANNEL}>\\n`);
    expect(out).not.toContain("Add to #");
    expect(out).not.toContain("proof/ctx/pick/");
    expect(out).toContain(`proof/ctx/user/${CHANNEL}/${MESSAGE}`);
  });

  test("lists at most the newest 10 cases", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      makeCase({ caseId: `${100 - i}` }),
    );
    const out = json(
      buildAddAsProofPicker({
        message: message(),
        user: { id: TARGET, username: "spambot" },
        showing: "author",
        cases: many,
        emojis,
        now: NOW,
      }),
    );

    expect(out).toContain('"value":"91"');
    expect(out).not.toContain('"value":"90"');
  });
});

describe("Add as proof confirmation", () => {
  const proof: CaseProof = {
    id: "1",
    guildId: GUILD,
    caseId: "4822",
    authorId: MOD,
    createdAt: NOW,
    content: null,
    attachments: ["https://cdn.discordapp.com/attachments/1/2/a.png"],
    sourceMessageUrl: message().url,
    sourceAuthorId: TARGET,
    sourceContent: "I'm giving away free nitro",
    hostMessageId: "1029384756102938499",
    source: "context_menu",
  };

  test("names the case and what was saved", () => {
    const out = json(
      buildAddAsProofDone({
        moderationCase: makeCase(),
        proof,
        files: message().files,
        emojis,
      }),
    );

    expect(out).toContain(
      `✅ Added to case #4822 as proof · ${botEmoji("ban")} Ban · <@${TARGET}>`,
    );
    expect(out).toContain(
      "-# Message link, text and 1 image saved · mod log entry updated",
    );
  });

  test("a link alone without a mod log entry", () => {
    const out = json(
      buildAddAsProofDone({
        moderationCase: makeCase(),
        proof: {
          ...proof,
          sourceContent: null,
          attachments: [],
          hostMessageId: null,
        },
        files: [],
        emojis,
      }),
    );

    expect(out).toContain("-# Message link saved");
    expect(out).not.toContain("mod log entry updated");
  });
});
