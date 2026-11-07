import { describe, expect, test } from "bun:test";

import {
  GUILD,
  MOD,
  TARGET,
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
  buildAddAsProofUndoCustomId,
  buildAddAsProofUndoFailed,
  buildAddAsProofUndone,
  buildCaseNumberModal,
  caseNumberNotice,
  parseAddAsProofCustomId,
  parseAddAsProofUndoCustomId,
  proofSourceContent,
  readCaseNumber,
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
    const ref = {
      channelId: "12345678901234567890",
      messageId: "12345678901234567890",
    };
    const ids = [
      { kind: "pick" as const, ...ref },
      { kind: "scope" as const, scope: "author" as const, ...ref },
      { kind: "number" as const, scope: "recent" as const, ...ref },
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
      `proof/ctx/add/${CHANNEL}/${MESSAGE}/4822`,
      `proof/ctx/pick/${CHANNEL}/${MESSAGE}/4822`,
      `proof/ctx/pick/${CHANNEL}`,
      `proof/ctx/scope/${CHANNEL}/${MESSAGE}`,
      `proof/ctx/scope/${CHANNEL}/${MESSAGE}/other`,
      `proof/ctx/number/x/${MESSAGE}/recent`,
      `proof/ctx/other/${CHANNEL}/${MESSAGE}`,
    ]) {
      expect(parseAddAsProofCustomId(customId)).toBeNull();
    }
  });

  test("undo ids round-trip, fit 100 characters and reject the rest", () => {
    const id = { caseId: "999999999999999999", proofId: "9223372036854775807" };
    const customId = buildAddAsProofUndoCustomId(id);

    expect(customId.length).toBeLessThanOrEqual(100);
    expect(parseAddAsProofUndoCustomId(customId)).toEqual(id);
    for (const other of [
      "proof/undo/4822",
      "proof/undo/4822/x",
      "proof/undo/4822/1/2",
      `proof/ctx/pick/${CHANNEL}/${MESSAGE}`,
    ]) {
      expect(parseAddAsProofUndoCustomId(other)).toBeNull();
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
  const author = { id: TARGET, username: "spambot" };
  const cases = [
    makeCase({ caseId: "4822" }),
    makeCase({
      caseId: "4801",
      actionType: ActionType.Warn,
      reason: "Posting invite links",
    }),
  ];
  const picker = (
    overrides: Partial<Parameters<typeof buildAddAsProofPicker>[0]> = {},
  ) =>
    buildAddAsProofPicker({
      message: message(),
      author,
      scope: "recent",
      cases,
      emojis,
      now: NOW,
      ...overrides,
    });

  test("recent cases name their user, with both buttons", () => {
    const payload = picker();
    const out = json(payload);

    expect(out).toContain("**Add this message as proof**");
    expect(out).toContain("> I'm giving away free nitro, claim here");
    expect(out).toContain(`-# From <@${TARGET}> in <#${CHANNEL}> · 1 image`);
    expect(out).toContain("Pick a recent case…");
    expect(out).toContain(`#4822 Ban · ${makeCase().userTag} · 2 hours ago`);
    expect(out).toContain("Posting invite links");
    expect(out).toContain("Enter case number…");
    expect(out).toContain("Show only spambot's cases");
    expect(out).toContain(`proof/ctx/scope/${CHANNEL}/${MESSAGE}/author`);
    expect(out).toContain(`proof/ctx/number/${CHANNEL}/${MESSAGE}/recent`);
    expect(payload.allowedMentions).toEqual({ parse: [] });
  });

  test("the author filter drops the username and offers the way back", () => {
    const out = json(picker({ scope: "author" }));

    expect(out).toContain(`-# Showing <@${TARGET}>'s cases`);
    expect(out).toContain("Pick one of spambot's cases…");
    expect(out).toContain("#4822 Ban · 2 hours ago");
    expect(out).toContain("Show all recent cases");
    expect(out).toContain(`proof/ctx/scope/${CHANNEL}/${MESSAGE}/recent`);
    expect(out).toContain(`proof/ctx/number/${CHANNEL}/${MESSAGE}/author`);
  });

  test("an author without cases has no select but can go back", () => {
    const out = json(picker({ scope: "author", cases: [] }));

    expect(out).toContain(
      `-# <@${TARGET}> has no cases. Use \`/note\` to keep a note about them.`,
    );
    expect(out).not.toContain("proof/ctx/pick/");
    expect(out).toContain("Show all recent cases");
  });

  test("a server without cases has nothing to pick", () => {
    const out = json(picker({ cases: [] }));

    expect(out).toContain("This server has no cases yet");
    expect(out).not.toContain("proof/ctx/pick/");
    expect(out).not.toContain("Enter case number");
  });

  test("a forward has no author filter", () => {
    const out = json(picker({ message: message({ forwarded: true }) }));

    expect(out).toContain("Forwards don't say who first wrote them");
    expect(out).toContain("Enter case number…");
    expect(out).not.toContain("Show only");
  });

  test("a notice shows under the message", () => {
    const out = json(picker({ notice: caseNumberNotice("9999") }));

    expect(out).toContain("-# ❌ No case #9999 in this server.");
  });

  test("lists at most 25 cases", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      makeCase({ caseId: `${100 - i}` }),
    );
    const out = json(picker({ cases: many }));

    expect(out).toContain('"value":"76"');
    expect(out).not.toContain('"value":"75"');
  });

  test("a long username stays within the button limit", () => {
    const payload = picker({
      author: { id: TARGET, username: "x".repeat(200) },
    });

    expect(() => json(payload)).not.toThrow();
  });
});

describe("Case number modal", () => {
  function fields(value: string) {
    return { getTextInputValue: () => value } as never;
  }

  test("says where to find the number", () => {
    const out = JSON.stringify(buildCaseNumberModal("id").toJSON());

    expect(out).toContain("Copy it from the mod log or /history");
  });

  test("accepts a pasted number with or without the #", () => {
    expect(readCaseNumber(fields("412"))).toBe("412");
    expect(readCaseNumber(fields(" #412 "))).toBe("412");
  });

  test("anything else isn't a case number", () => {
    for (const value of ["abc", "#", "12a", "1234567890123456789"]) {
      expect(readCaseNumber(fields(value))).toBeNull();
    }
    expect(caseNumberNotice(null)).toContain("That isn't a case number");
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
  const done = (
    overrides: Partial<Parameters<typeof buildAddAsProofDone>[0]> = {},
  ) =>
    json(
      buildAddAsProofDone({
        moderationCase: makeCase({ reason: "Scam links" }),
        proof,
        files: message().files,
        emojis,
        now: NOW,
        ...overrides,
      }),
    );

  test("shows what the case is, what was saved, and Undo", () => {
    const out = done();

    expect(out).toContain("✅ **Added as proof to case #4822**");
    expect(out).toContain(
      `${botEmoji("ban")} Ban · <@${TARGET}> · 2 hours ago`,
    );
    expect(out).toContain("> Scam links");
    expect(out).toContain(
      "-# Message link, text and 1 image saved · mod log entry updated",
    );
    expect(out).toContain('"label":"Undo"');
    expect(out).toContain("proof/undo/4822/1");
  });

  test("a case without a reason says so", () => {
    const out = done({ moderationCase: makeCase({ reason: null }) });

    expect(out).toContain("-# No reason set");
  });

  test("a long reason is shortened", () => {
    const out = done({
      moderationCase: makeCase({ reason: "x".repeat(500) }),
    });

    expect(out).not.toContain("x".repeat(201));
  });

  test("says how many files weren't saved", () => {
    expect(
      done({
        files: [{ contentType: "image/png" }, { contentType: "image/png" }],
        filesNotSaved: "one is over the 25 MB limit.",
      }),
    ).toContain(
      "-# None of the 2 images were saved: one is over the 25 MB limit.",
    );
    expect(done({ filesNotSaved: "it's over the 25 MB limit." })).toContain(
      "-# The image wasn't saved: it's over the 25 MB limit.",
    );
  });

  test("a link alone without a mod log entry", () => {
    const out = done({
      proof: {
        ...proof,
        sourceContent: null,
        attachments: [],
        hostMessageId: null,
      },
      files: [],
    });

    expect(out).toContain("-# Message link saved");
    expect(out).not.toContain("mod log entry updated");
  });
});

describe("Add as proof undo", () => {
  test("names the case it left", () => {
    const out = json(buildAddAsProofUndone(makeCase(), emojis));

    expect(out).toContain(
      `↩️ Removed from case #4822 · ${botEmoji("ban")} Ban · <@${TARGET}>`,
    );
    expect(out).not.toContain("proof/undo/");
  });

  test("a failure keeps Undo, since the proof is still there", () => {
    const out = json(
      buildAddAsProofUndoFailed({ caseId: "4822", proofId: "1" }),
    );

    expect(out).toContain("still on case #4822");
    expect(out).toContain("proof/undo/4822/1");
  });
});
