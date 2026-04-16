import { describe, expect, it } from "bun:test";

import { formatHexColor, parseHexColor } from "./ScheduleConfigConstants";

describe("parseHexColor", () => {
  it("returns null for blank input", () => {
    expect(parseHexColor("").val).toBeNull();
    expect(parseHexColor("   ").val).toBeNull();
  });

  it("parses a valid 6-digit hex with # prefix", () => {
    expect(parseHexColor("#96cdfb").val).toBe(0x96cdfb);
  });

  it("parses a valid 6-digit hex without # prefix", () => {
    expect(parseHexColor("ff6b6b").val).toBe(0xff6b6b);
  });

  it("accepts uppercase hex digits", () => {
    expect(parseHexColor("#AABBCC").val).toBe(0xaabbcc);
  });

  it("accepts mixed-case hex digits", () => {
    expect(parseHexColor("#aAbBcC").val).toBe(0xaabbcc);
  });

  it("parses boundary value #000000", () => {
    expect(parseHexColor("#000000").val).toBe(0);
  });

  it("parses boundary value #ffffff", () => {
    expect(parseHexColor("#ffffff").val).toBe(0xffffff);
  });

  it("returns Err for a 3-digit short-form hex", () => {
    const result = parseHexColor("#fff");
    expect(result.ok).toBe(false);
  });

  it("returns Err for non-hex characters", () => {
    const result = parseHexColor("#xyz123");
    expect(result.ok).toBe(false);
  });

  it("returns Err for a 7-digit hex (too long)", () => {
    const result = parseHexColor("#1234567");
    expect(result.ok).toBe(false);
  });
});

describe("formatHexColor", () => {
  it("formats a color as lowercase #rrggbb", () => {
    expect(formatHexColor(0x96cdfb)).toBe("#96cdfb");
  });

  it("zero-pads short values", () => {
    expect(formatHexColor(0x000001)).toBe("#000001");
  });

  it("formats black", () => {
    expect(formatHexColor(0)).toBe("#000000");
  });

  it("formats white", () => {
    expect(formatHexColor(0xffffff)).toBe("#ffffff");
  });

  it("round-trips with parseHexColor", () => {
    const original = 0xff6b6b;
    const formatted = formatHexColor(original);
    const parsed = parseHexColor(formatted);
    expect(parsed.ok).toBe(true);
    expect(parsed.val).toBe(original);
  });
});
