import { describe, expect, test } from "bun:test";

import {
  safeAttachmentName,
  splitCaseAttachments,
  stripCdnSignature,
} from "./caseMedia";

describe("splitCaseAttachments", () => {
  test("media goes to the gallery, other files stay links", () => {
    expect(
      splitCaseAttachments([
        "https://cdn.discordapp.com/attachments/1/2/a.png?ex=1&is=2&hm=3&",
        "https://cdn.discordapp.com/attachments/1/2/b.pdf",
        "",
        "https://cdn.discordapp.com/attachments/1/2/c.MP4",
      ]),
    ).toEqual({
      media: [
        "https://cdn.discordapp.com/attachments/1/2/a.png?ex=1&is=2&hm=3&",
        "https://cdn.discordapp.com/attachments/1/2/c.MP4",
      ],
      links: ["https://cdn.discordapp.com/attachments/1/2/b.pdf"],
    });
  });

  test("a gallery holds at most 10 items; the rest are links", () => {
    const urls = Array.from(
      { length: 12 },
      (_, i) => `https://cdn.example/${i}.png`,
    );
    const { media, links } = splitCaseAttachments(urls);
    expect(media).toHaveLength(10);
    expect(links).toEqual(urls.slice(10));
  });
});

describe("stripCdnSignature", () => {
  test("drops only the signature params", () => {
    expect(
      stripCdnSignature(
        "https://cdn.discordapp.com/attachments/1/2/a.png?ex=1&is=2&hm=3&",
      ),
    ).toBe("https://cdn.discordapp.com/attachments/1/2/a.png");
    expect(
      stripCdnSignature("https://cdn.example/a.png?size=64&ex=1&is=2&hm=3"),
    ).toBe("https://cdn.example/a.png?size=64");
  });

  test("leaves an unparseable URL alone", () => {
    expect(stripCdnSignature("not a url")).toBe("not a url");
  });
});

describe("safeAttachmentName", () => {
  test("replaces characters Discord would rewrite and keeps the extension", () => {
    expect(safeAttachmentName("proof 1 (final).PNG")).toBe(
      "proof_1__final_.PNG",
    );
    expect(safeAttachmentName("스크린샷.jpg")).toBe("____.jpg");
    expect(safeAttachmentName(".png")).toBe("attachment.png");
  });
});
