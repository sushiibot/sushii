import { describe, expect, test } from "bun:test";
import { ButtonStyle } from "discord.js";

import type { CaseProof } from "../../domain/entities/CaseProof";
import {
  type ProofEmojis,
  addProofButton,
  proofEntryText,
  proofFileLinks,
  proofHeading,
  proofMediaUrls,
} from "./proofBlock";

const EMOJIS: ProofEmojis = {
  lock: "<:lock:1>",
  attachment: "<:attachment:123456789012345678>",
};
const NO_EMOJIS: ProofEmojis = { lock: "", attachment: "" };
const MOD = "444444444444444444";
const AUTHOR = "222222222222222222";
const CREATED = new Date("2026-11-03T10:00:00Z");
const UNIX = Math.floor(CREATED.getTime() / 1000);

function makeProof(overrides: Partial<CaseProof> = {}): CaseProof {
  return {
    id: "1",
    guildId: "111111111111111111",
    caseId: "4822",
    authorId: MOD,
    createdAt: CREATED,
    content: null,
    attachments: [],
    sourceMessageUrl: null,
    sourceAuthorId: null,
    sourceContent: null,
    hostMessageId: null,
    source: "button",
    ...overrides,
  };
}

describe("proofHeading", () => {
  test("names the block and its audience", () => {
    expect(proofHeading(EMOJIS)).toBe("**<:lock:1> Proof** · mods only");
  });

  test("keeps the bold valid without the emoji", () => {
    expect(proofHeading(NO_EMOJIS)).toBe("**Proof** · mods only");
  });
});

describe("proofEntryText", () => {
  test("text only", () => {
    expect(
      proofEntryText(makeProof({ content: "Spammed in #general" }), EMOJIS),
    ).toBe(`-# <@${MOD}> · <t:${UNIX}:R>\nSpammed in #general`);
  });

  test("counts files, singular and plural", () => {
    expect(
      proofEntryText(makeProof({ attachments: ["https://x/a.png"] }), EMOJIS),
    ).toBe(`-# <@${MOD}> · <t:${UNIX}:R> · 1 file`);
    expect(
      proofEntryText(
        makeProof({ attachments: ["https://x/a.png", "https://x/b.png"] }),
        EMOJIS,
      ),
    ).toBe(`-# <@${MOD}> · <t:${UNIX}:R> · 2 files`);
  });

  test("shows an unknown mod for a null author", () => {
    expect(
      proofEntryText(
        makeProof({ authorId: null, attachments: ["https://x/a.png"] }),
        EMOJIS,
      ),
    ).toBe(`-# Unknown mod · <t:${UNIX}:R> · 1 file`);
  });

  test("source message: quoted text then the raw link", () => {
    const url =
      "https://discord.com/channels/187450744427773963/1029384756102938400/1029384756102938777";

    expect(
      proofEntryText(
        makeProof({
          content: "context",
          sourceAuthorId: AUTHOR,
          sourceContent: "free nitro\nclaim here: https://scam.example/xyz",
          sourceMessageUrl: url,
          attachments: ["https://x/a.png"],
        }),
        EMOJIS,
      ),
    ).toBe(
      [
        `-# <@${MOD}> · <t:${UNIX}:R> · 1 file · message from <@${AUTHOR}>`,
        "context",
        "> free nitro",
        "> claim here: https://scam.example/xyz",
        url,
      ].join("\n"),
    );
  });

  test("escapes masked links, headings and lists in the quoted message", () => {
    const text = proofEntryText(
      makeProof({
        sourceAuthorId: AUTHOR,
        sourceContent:
          "[discord.com/gift](https://evil.example/x)\n# Free nitro\n- claim\n1. now",
      }),
      EMOJIS,
    );

    expect(text).toContain("> \\[discord.com/gift](https://evil.example/x)");
    expect(text).not.toMatch(/(^|[^\\])\[discord\.com\/gift\]\(/);
    expect(text).toContain("> \\# Free nitro");
    expect(text).toContain("> \\- claim");
    expect(text).toContain("> 1\\. now");
  });

  test("keeps URLs raw and never truncates", () => {
    const long = `${"a".repeat(990)} https://example.com/evidence`;
    const text = proofEntryText(makeProof({ content: long }), EMOJIS);

    expect(text.endsWith(long)).toBe(true);
    expect(text).not.toContain("](");
    expect(text).not.toContain("<https://");
  });
});

describe("proofMediaUrls / proofFileLinks", () => {
  test("splits every entry's files into gallery media and raw links", () => {
    const proofs = [
      makeProof({ attachments: ["https://x/a.png", "https://x/log.txt"] }),
      makeProof({ attachments: ["", "https://x/b.mp4"] }),
      makeProof(),
    ];

    expect(proofMediaUrls(proofs)).toEqual([
      "https://x/a.png",
      "https://x/b.mp4",
    ]);
    expect(proofFileLinks(proofs)).toEqual(["https://x/log.txt"]);
  });
});

describe("proofMediaUrls overflow", () => {
  test("media past the 10-item gallery go to the file links", () => {
    const urls = Array.from(
      { length: 11 },
      (_, i) => `https://x/shot-${i + 1}.png`,
    );
    const proofs = [makeProof({ attachments: urls })];

    expect(proofMediaUrls(proofs)).toEqual(urls.slice(0, 10));
    expect(proofFileLinks(proofs)).toEqual(["https://x/shot-11.png"]);
  });
});

describe("addProofButton", () => {
  test("primary Add proof button for the cases", () => {
    const json = addProofButton(["4822", "4823"], EMOJIS).toJSON();

    expect(json).toMatchObject({
      style: ButtonStyle.Primary,
      label: "Add proof",
      custom_id: "caseProof/add/4822-4823",
      disabled: false,
      emoji: { name: "attachment", id: "123456789012345678" },
    });
  });

  test("can be disabled and works without the emoji", () => {
    const json = addProofButton(["1"], NO_EMOJIS, { disabled: true }).toJSON();

    expect(json).toMatchObject({ disabled: true, label: "Add proof" });
    expect("emoji" in json && json.emoji).toBeFalsy();
  });
});
