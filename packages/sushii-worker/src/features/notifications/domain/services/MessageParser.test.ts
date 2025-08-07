import { describe, expect, test } from "bun:test";

import { containsKeyword, extractKeywords } from "./MessageParser";

describe("MessageParser", () => {
  test("extracts keywords from message", () => {
    const keywords = extractKeywords("Hello world test");

    expect(keywords).toContain("hello");
    expect(keywords).toContain("world");
    expect(keywords).toContain("test");
  });

  test("filters empty words", () => {
    const keywords = extractKeywords("hello   world");

    expect(keywords).not.toContain("");
    expect(keywords).toContain("hello");
    expect(keywords).toContain("world");
  });

  test("detects keyword in message", () => {
    const contains = containsKeyword("Hello world", "world");

    expect(contains).toBe(true);
  });

  test("does not detect missing keyword", () => {
    const contains = containsKeyword("Hello world", "test");

    expect(contains).toBe(false);
  });
});
