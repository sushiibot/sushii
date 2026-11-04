import { describe, expect, test } from "bun:test";

import { splitAtLineBreaks } from "./ModLogProofReplyView";

describe("splitAtLineBreaks", () => {
  test("short text stays one piece", () => {
    expect(splitAtLineBreaks("a\nb", 10)).toEqual(["a\nb"]);
  });

  test("splits at line breaks and loses nothing", () => {
    const text = "a\n".repeat(1000) + "end";
    const pieces = splitAtLineBreaks(text, 300);

    expect(pieces.every((p) => p.length <= 300)).toBe(true);
    expect(pieces.join("\n")).toBe(text);
  });

  test("a line longer than the limit is cut mid-line", () => {
    const pieces = splitAtLineBreaks(`x\n${"y".repeat(25)}\nz`, 10);

    expect(pieces.every((p) => p.length <= 10)).toBe(true);
    expect(pieces.join("").replaceAll("\n", "")).toBe(`x${"y".repeat(25)}z`);
  });
});
