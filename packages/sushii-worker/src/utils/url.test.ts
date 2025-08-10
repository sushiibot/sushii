import { describe, expect, it } from "bun:test";

import { getCleanFilename } from "./url";

describe("getCleanFilename", () => {
  it("should extract filename from Discord CDN URL with query params", () => {
    const url =
      "https://cdn.discordapp.com/attachments/123/456/IMG_5169.png?ex=6895852c&is=689433ac&hm=f855ec497045b1bfe249a7f9e3b7a53243a43f98b064d2f3070b6686f0a5fd3b&";
    expect(getCleanFilename(url)).toBe("IMG_5169.png");
  });

  it("should extract filename from URL without query params", () => {
    const url = "https://example.com/path/to/document.pdf";
    expect(getCleanFilename(url)).toBe("document.pdf");
  });

  it("should handle URLs with multiple path segments", () => {
    const url =
      "https://cdn.discordapp.com/attachments/server/channel/my-file-name.jpg?ex=12345";
    expect(getCleanFilename(url)).toBe("my-file-name.jpg");
  });

  it("should handle URLs with spaces encoded", () => {
    const url = "https://example.com/My%20Document.docx?version=2";
    expect(getCleanFilename(url)).toBe("My%20Document.docx");
  });

  it("should handle invalid URLs gracefully", () => {
    const url = "not-a-valid-url/file.txt?param=value";
    expect(getCleanFilename(url)).toBe("file.txt");
  });

  it("should handle URLs with fragments", () => {
    const url = "https://example.com/page.html#section?query=test";
    expect(getCleanFilename(url)).toBe("page.html");
  });

  it("should return just the filename for simple paths", () => {
    const url = "image.png?size=large";
    expect(getCleanFilename(url)).toBe("image.png");
  });
});
